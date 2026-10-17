import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARKET_WRITE_LOCK } from '@metra/db/market-seed';
import { holdSeedBookSteady, writeSeedPlan } from '@metra/db/market-seed/db';
import { withOrgContext } from '@/lib/db/context';
import { loadMarketPriceBookCore } from '@/lib/market-book/seed-core';
import { closeFixture, ctxFor, raw, teardown } from './fixture';
import { asAppRole, closeMarketFixture, marketRaw } from './market-fixture';
import { clearSeedFixture, cliSeed, createStudio, publishSeedFixture, rebuildSeedBook, seededRows, signUp } from './market-seed-fixture';

// The empty price book's "load the official market price book": the sign-up
// seed again, for a studio whose seed failed or that emptied its book. It adds
// nothing twice, is for owners and admins only, and the seed book it reads is
// SELECT-only reference data that only a member org context sees.

const orgIds: string[] = [];

beforeAll(async () => {
  await publishSeedFixture();
  await rebuildSeedBook();
});

afterAll(async () => {
  await teardown(orgIds);
  await clearSeedFixture();
  await closeMarketFixture();
  await closeFixture();
});

describe('loadMarketPriceBookCore', () => {
  it('loads a studio that has none, then adds nothing on a second load or after the sign-up seed', async () => {
    const studio = await createStudio(orgIds, 'Load from empty');
    const first = await loadMarketPriceBookCore(studio);
    expect(first).toMatchObject({ ok: true, data: { published: true } });
    expect(first.data?.items).toBeGreaterThanOrEqual(2);
    const loaded = await seededRows(studio.orgId);
    expect(loaded).toHaveLength(first.data?.items as number);
    expect(await loadMarketPriceBookCore(studio)).toEqual({ ok: true, data: { published: true, sections: 0, items: 0 } });
    expect(await seededRows(studio.orgId)).toEqual(loaded);
  });

  it('adds nothing to a studio the sign-up already seeded', async () => {
    const { ctx: studio } = await signUp(orgIds, 'Seeded at sign-up');
    const seeded = await seededRows(studio.orgId);
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    expect(await loadMarketPriceBookCore(studio)).toEqual({ ok: true, data: { published: true, sections: 0, items: 0 } });
    expect(await seededRows(studio.orgId)).toEqual(seeded);
  });

  it('skips a market item named like one of the studio own items, exactly as the CLI does', async () => {
    const studio = await createStudio(orgIds, 'Load with own item');
    const twin = await createStudio(orgIds, 'Load with own item, CLI');
    for (const orgId of [studio.orgId, twin.orgId]) {
      await raw.query(`insert into cost_items (org_id, code, name_ar, section_id, unit)
                       select '${orgId}', 'OWN-GLASS', 'زجاج  بذر الاختبار', id, 'sqm' from sections where org_id = '${orgId}' and key = 'civil'`);
    }
    await loadMarketPriceBookCore(studio);
    await cliSeed(twin.orgId);
    const rows = await seededRows(studio.orgId);
    expect(rows.map((row) => row.name_en)).not.toContain('Seed test glass');
    expect(rows.map((row) => row.name_en)).toContain('Seed test wire roll of 100 m');
    expect(rows).toEqual(await seededRows(twin.orgId));
  });

  it('refuses a role without price-book create, and writes nothing', async () => {
    const studio = await createStudio(orgIds, 'Load forbidden');
    for (const role of ['project_manager', 'site_engineer', 'accountant', 'viewer'] as const) {
      expect(await loadMarketPriceBookCore(ctxFor(studio.orgId, studio.userId, role))).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await seededRows(studio.orgId)).toEqual([]);
  });
});

describe('the stored book a seed writes from', () => {
  it('cannot be rebuilt while a seed holds it', async () => {
    const studio = await createStudio(orgIds, 'Hold the book');
    const tryWrite = async () => (await marketRaw()`select pg_try_advisory_lock(hashtext(${MARKET_WRITE_LOCK})) as got`)[0].got as boolean;
    const during = await withOrgContext(studio, async (tx) => {
      await holdSeedBookSteady(tx);
      return tryWrite();
    });
    expect(during).toBe(false);
    expect(await tryWrite()).toBe(true);
    await marketRaw()`select pg_advisory_unlock(hashtext(${MARKET_WRITE_LOCK}))`;
  });

  it('refuses a planned item the book does not have, and writes nothing at all', async () => {
    const studio = await createStudio(orgIds, 'Stale plan');
    const plan = {
      sectionsPresent: 0,
      sectionsToCreate: [{ key: 'market.finishing.glass', nameAr: 'الزجاج', nameEn: 'Glass', qualified: false }],
      itemsToCreate: [{ marketItemId: randomUUID(), section: { key: 'market.finishing.glass' }, code: 'MKT-gone', nameAr: 'x', nameEn: 'x', unit: 'sqm' as const, defaultUnitCost: '1.0000', defaultUnitPrice: '1.0500' }],
      skipped: { already_linked: 0, discontinued: 0, unit_unsupported: 0, no_price: 0, code_clash: 0, name_clash: 0 },
    };
    await expect(withOrgContext(studio, (tx) => writeSeedPlan(tx, plan, 'dbtest'))).rejects.toThrow('no longer has 1 planned item');
    expect(await raw.query(`select id from sections where org_id = '${studio.orgId}' and key like 'market.%'`)).toEqual([]);
  });
});

describe('the seed book under RLS', () => {
  it('is read only inside a member org context, and seeds only that studio', async () => {
    const seeded = await createStudio(orgIds, 'Isolation seeded');
    const other = await createStudio(orgIds, 'Isolation other');
    await loadMarketPriceBookCore(seeded);
    const count = 'select count(*)::int as n from market_seed_book';
    const member = { 'app.current_org_id': other.orgId, 'app.current_user_id': other.userId };
    expect((await asAppRole<{ n: number }>(member, count))[0].n).toBeGreaterThanOrEqual(5);
    expect(await asAppRole<{ n: number }>({}, count)).toEqual([{ n: 0 }]);
    expect(await asAppRole<{ n: number }>({ 'app.current_org_id': other.orgId, 'app.current_user_id': randomUUID() }, count)).toEqual([{ n: 0 }]);
    expect(await asAppRole<{ n: number }>(member, "select count(*)::int as n from cost_items where code like 'MKT-%'")).toEqual([{ n: 0 }]);
    expect(await raw.count('cost_items', other.orgId)).toBe(0);
  });

  it('refuses every write from metra_app, even in a member org context', async () => {
    const studio = await createStudio(orgIds, 'Isolation writer');
    const member = { 'app.current_org_id': studio.orgId, 'app.current_user_id': studio.userId };
    for (const write of [
      'delete from market_seed_book',
      "update market_seed_book set unit_cost = 0, unit_price = 0",
      "insert into market_seed_book (item_id, position, code, name_ar, name_en, name_forms, status, leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en) select item_id, 99999, 'MKT-x', 'x', 'x', '{}', 'active', 'k', 'x', 'x', 'x', 'x' from market_seed_book limit 1",
    ]) {
      await expect(asAppRole(member, write)).rejects.toMatchObject({ code: '42501' });
    }
  });
});
