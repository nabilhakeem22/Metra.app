import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMarketPriceBookCore } from '@/lib/market-book/seed-core';
import { closeFixture, ctxFor, raw, teardown } from './fixture';
import { asAppRole, closeMarketFixture } from './market-fixture';
import { afterTasks, clearSeedFixture, cliSeed, createStudio, publishSeedFixture, rebuildSeedBook, runAfterResponse, seededRows, signUp } from './market-seed-fixture';

// The empty price book's "load the official market price book": the sign-up
// seed again, for a studio whose seed failed or that emptied its book. It adds
// nothing twice, is for owners and admins only, and the seed book it reads is
// SELECT-only reference data that only a member org context sees.

vi.mock('next/server', () => ({ after: (task: () => Promise<unknown>) => void afterTasks.push(task) }));

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
    const studio = await signUp(orgIds, 'Seeded at sign-up');
    await runAfterResponse();
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
