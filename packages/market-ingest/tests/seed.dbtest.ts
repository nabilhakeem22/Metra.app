import { ORG_A_ID, ORG_B_ID, USER_A_ID, USER_B_ID } from '@metra/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCommand } from '../src/commands/seed-command';
import { clearMarketTestData } from './db-fixture';
import { STUDIOS, clearSeeded, fixtureItems, planOf, publishFixture, run, seededIn, sql } from './seed-fixture';

// market:seed-price-books on a local database with the two fixture studios
// (npm run seed), whether or not a real bulletin is published there too. The
// fixture bulletin covers every path: a priced item, a roll, a bag (no studio
// unit), an item whose newest month is suspended (the month before is used),
// and one never priced.

const breakPlan = vi.hoisted(() => ({ on: false }));
vi.mock('@metra/db/market-seed', async (original) => {
  const real = await original<typeof import('@metra/db/market-seed')>();
  return {
    ...real,
    planSeed: (...args: Parameters<typeof real.planSeed>) => {
      const plan = real.planSeed(...args);
      if (!breakPlan.on || plan.itemsToCreate.length === 0) return plan;
      // The same item twice: the database refuses the second (a unique code per studio).
      return { ...plan, itemsToCreate: [...plan.itemsToCreate, plan.itemsToCreate[0]] };
    },
  };
});

let printed: string[] = [];

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  breakPlan.on = false;
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line));
});

afterAll(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await sql.end();
});

describe('market:seed-price-books', () => {
  it('the fixture adds exactly its own counts, the dry run writes nothing, and the real run creates what it planned', async () => {
    const before = planOf(await run(true), ORG_A_ID);
    await publishFixture();
    const dry = planOf(await run(true), ORG_A_ID);
    expect(dry.itemsToCreate.length - before.itemsToCreate.length).toBe(3);
    expect(dry.skipped.unit_unsupported - before.skipped.unit_unsupported).toBe(1);
    expect(dry.skipped.no_price - before.skipped.no_price).toBe(1);
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    const real = planOf(await run(false), ORG_A_ID);
    expect(real.itemsToCreate).toEqual(dry.itemsToCreate);
    expect(await seededIn(ORG_A_ID)).toHaveLength(3);
  });

  it('creates priced items at cost x 1.05, the roll named with its pack, linked and active, with an audit row each', async () => {
    await publishFixture();
    await run(false);
    expect(await seededIn(ORG_A_ID)).toEqual([
      { code: 'MKT-raw.steel.dbtest_rebar', name_ar: 'حديد اختبار البذر', unit: 'ton', cost: '39850.0000', price: '41842.5000', market: true, active: true, section_key: 'market.raw.steel' },
      { code: 'MKT-raw.steel.dbtest_stamped', name_ar: 'ركيزة اختبار البذر', unit: 'pcs', cost: '8721.0000', price: '9157.0500', market: true, active: true, section_key: 'market.raw.steel' },
      { code: 'MKT-raw.steel.dbtest_wire', name_ar: 'سلك اختبار البذر لفة 100 م', unit: 'roll', cost: '30.4550', price: '31.9778', market: true, active: true, section_key: 'market.raw.steel' },
    ]);
    const audits = await sql`select a.actor_user_id from audit_log a join cost_items c on c.id = a.entity_id
                              where a.org_id = ${ORG_A_ID} and c.code like 'MKT-raw.steel.dbtest_%' and a.after->>'source' = 'market:seed-price-books'`;
    expect(audits.map((row) => row.actor_user_id)).toEqual([USER_A_ID, USER_A_ID, USER_A_ID]);
  });

  it('is idempotent: a second run creates nothing, and prints already present and already linked', async () => {
    await publishFixture();
    await run(false);
    const second = await run(false);
    for (const orgId of STUDIOS) {
      expect(planOf(second, orgId).itemsToCreate).toEqual([]);
      expect(planOf(second, orgId).sectionsToCreate).toEqual([]);
    }
    expect(await seedCommand(['--dry-run', '--org', ORG_A_ID])).toBe(0);
    expect(printed.join('\n')).toMatch(/items: to create 0,[\s\S]*already linked [1-9]/);
  });

  it('skips a code or name clash with a studio item, leaving it untouched; the other studio is seeded', async () => {
    await publishFixture();
    const [section] = await sql`select id from sections where org_id = ${ORG_A_ID} limit 1`;
    await sql`insert into cost_items (org_id, code, name_en, section_id, unit, default_unit_cost)
              values (${ORG_A_ID}, 'MKT-raw.steel.dbtest_rebar', 'The studio''s own rebar', ${section.id}, 'ton', '1')`;
    await sql`insert into cost_items (org_id, code, name_ar, section_id, unit) values (${ORG_A_ID}, 'OWN-CLASH', ${'سلك اختبار' + String.fromCharCode(0x200f) + ' البذر لفة 100 م'}, ${section.id}, 'roll')`;
    await run(false);
    expect(fixtureItems(planOf(await run(true), ORG_A_ID))).toEqual([]);
    const [own] = await sql`select name_en, default_unit_cost::text as cost, market_item_id from cost_items where org_id = ${ORG_A_ID} and code = 'MKT-raw.steel.dbtest_rebar'`;
    expect(own).toEqual({ name_en: "The studio's own rebar", cost: '1.0000', market_item_id: null });
    expect((await seededIn(ORG_A_ID)).filter((row) => row.market).map((row) => row.code)).toEqual(['MKT-raw.steel.dbtest_stamped']);
    expect(await seededIn(ORG_B_ID)).toHaveLength(3);
  });

  it('keeps each studio in its own rows (RLS): org B sees none of org A seeded items', async () => {
    await publishFixture();
    await run(false, [ORG_A_ID]);
    const visible = await sql.begin(async (tx) => {
      await tx`select set_config('app.current_org_id', ${ORG_B_ID}, true), set_config('app.current_user_id', ${USER_B_ID}, true)`;
      await tx.unsafe('set local role metra_app');
      return tx`select count(*)::int as n from cost_items where code like 'MKT-%'`;
    });
    expect(visible).toEqual([{ n: 0 }]);
    expect(await seededIn(ORG_A_ID)).toHaveLength(3);
  });

  it('rolls a failing studio back completely; a re-run completes it', async () => {
    await publishFixture();
    breakPlan.on = true;
    expect(await seedCommand(['--org', ORG_A_ID])).toBe(1);
    expect(printed.join('\n')).toContain('FAILED, nothing written for this studio: SQLSTATE 23505');
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    expect(await sql`select id from sections where org_id = ${ORG_A_ID} and key like 'market.%'`).toEqual([]);
    breakPlan.on = false;
    expect(await seedCommand(['--org', ORG_A_ID])).toBe(0);
    expect(await seededIn(ORG_A_ID)).toHaveLength(3);
  });

  it('takes an upper-case --org, and refuses one that is not a uuid or not an organization', async () => {
    expect(await seedCommand(['--dry-run', '--org', ORG_A_ID.toUpperCase()])).toBe(0);
    await expect(seedCommand(['--org', 'acme'])).rejects.toThrow('--org takes an organization id');
    await expect(seedCommand(['--org', '00000000-0000-4000-8000-0000000000ff'])).rejects.toThrow('no organization');
  });
});
