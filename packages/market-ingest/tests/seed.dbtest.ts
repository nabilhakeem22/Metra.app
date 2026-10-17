import { ORG_A_ID, ORG_B_ID, USER_A_ID, USER_B_ID } from '@metra/db';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCommand } from '../src/commands/seed-command';
import { clearMarketTestData, openTestDatabase, seedPublished } from './db-fixture';

// market:seed-price-books on a local database seeded with the two fixture
// studios (npm run seed). One published bulletin of five fixture items covers
// every path: a priced item, a roll, a bag (no studio unit), an item whose
// newest month is suspended (the month before is used), and one that is never
// priced.

const breakPlan = vi.hoisted(() => ({ on: false }));
vi.mock('../src/seed/plan', async (original) => {
  const real = await original<typeof import('../src/seed/plan')>();
  return {
    ...real,
    planSeed: (...args: Parameters<typeof real.planSeed>) => {
      const plan = real.planSeed(...args);
      if (!breakPlan.on || plan.itemsToCreate.length === 0) return plan;
      return { ...plan, itemsToCreate: [...plan.itemsToCreate, { ...plan.itemsToCreate[0], code: 'MKT-broken', defaultUnitCost: '-1.0000' }] };
    },
  };
});

const sql = openTestDatabase();
const ORGS = ['--org', ORG_A_ID, '--org', ORG_B_ID];
let printed: string[] = [];

async function clearSeeded(): Promise<void> {
  await sql`delete from audit_log where after->>'source' = 'market:seed-price-books'`;
  await sql`delete from cost_items where code like 'MKT-%' or code = 'OWN-CLASH'`;
  await sql`delete from sections where key like 'market.%'`;
}

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  breakPlan.on = false;
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line));
  await seedPublished(sql, '2003-09', [
    { key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد', nameAr: 'حديد التسليح', nameEn: 'Rebar', prices: [['2003-08', '38200'], ['2003-09', '39850']] },
    { key: 'raw.steel.dbtest_wire', unit: 'roll', sourceLabel: 'سلك', nameAr: 'سلك', nameEn: 'Wire', pack: { lengthM: 100, pieces: null, pieceLengthM: null }, prices: [['2003-09', '30.455']] },
    { key: 'raw.steel.dbtest_bags', unit: 'bag', sourceLabel: 'شيكارة', nameAr: 'أسمنت', nameEn: 'Cement', prices: [['2003-09', '100']] },
    { key: 'raw.steel.dbtest_stamped', unit: 'pcs', sourceLabel: 'ركيزة', nameAr: 'ركيزة', nameEn: 'Bearing', prices: [['2003-08', '8721'], ['2003-09', null]] },
    { key: 'raw.steel.dbtest_never', unit: 'pcs', sourceLabel: 'فاصل', nameAr: 'فاصل', nameEn: 'Joint', prices: [['2003-09', null]] },
  ]);
});

afterAll(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await sql.end();
});

const seededIn = (orgId: string) => sql<Array<{ code: string; name_ar: string; unit: string; cost: string; price: string; market: boolean; active: boolean; section_key: string }>>`
  select c.code, c.name_ar, c.unit, c.default_unit_cost::text as cost, c.default_unit_price::text as price,
         c.market_item_id is not null as market, c.active, s.key as section_key
    from cost_items c join sections s on s.id = c.section_id
   where c.org_id = ${orgId} and c.code like 'MKT-%' order by c.code`;

describe('market:seed-price-books', () => {
  it('a dry run prints the counts the real run then creates, and writes nothing', async () => {
    expect(await seedCommand(['--dry-run', ...ORGS])).toBe(0);
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    const dry = printed.join('\n');
    expect(dry).toContain('DRY RUN, nothing is written.');
    expect(dry).toContain('sections: to create 1, already present 0');
    expect(dry).toContain('items: to create 3, skipped 2');
    expect(dry).toContain('already linked 0, discontinued 0, unit unsupported (bag, pack, thousand_bricks) 1, no price 1, code clash 0, name clash 0');
    printed = [];
    expect(await seedCommand(ORGS)).toBe(0);
    expect(printed.join('\n')).toContain('items: created 3, skipped 2');
  });

  it('creates priced items at cost x 1.05, the roll named with its pack, linked and active, in a market section', async () => {
    expect(await seedCommand(ORGS)).toBe(0);
    expect(await seededIn(ORG_A_ID)).toEqual([
      { code: 'MKT-raw.steel.dbtest_rebar', name_ar: 'حديد التسليح', unit: 'ton', cost: '39850.0000', price: '41842.5000', market: true, active: true, section_key: 'market.raw.steel' },
      { code: 'MKT-raw.steel.dbtest_stamped', name_ar: 'ركيزة', unit: 'pcs', cost: '8721.0000', price: '9157.0500', market: true, active: true, section_key: 'market.raw.steel' },
      { code: 'MKT-raw.steel.dbtest_wire', name_ar: 'سلك لفة 100 م', unit: 'roll', cost: '30.4550', price: '31.9778', market: true, active: true, section_key: 'market.raw.steel' },
    ]);
    const audits = await sql`select entity, actor_user_id from audit_log where org_id = ${ORG_A_ID} and after->>'source' = 'market:seed-price-books' order by entity`;
    expect(audits.map((row) => row.entity)).toEqual(['cost_item', 'cost_item', 'cost_item', 'section']);
    expect(new Set(audits.map((row) => row.actor_user_id))).toEqual(new Set([USER_A_ID]));
  });

  it('is idempotent: a second run creates nothing and finds everything already linked', async () => {
    expect(await seedCommand(ORGS)).toBe(0);
    printed = [];
    expect(await seedCommand(ORGS)).toBe(0);
    const second = printed.join('\n');
    expect(second).toContain('sections: created 0, already present 1');
    expect(second).toContain('items: created 0, skipped 5');
    expect(second).toContain('already linked 3');
    expect(await seededIn(ORG_A_ID)).toHaveLength(3);
  });

  it('skips a code or name clash with a studio item, leaving the studio item untouched', async () => {
    const [section] = await sql`select id from sections where org_id = ${ORG_A_ID} limit 1`;
    await sql`insert into cost_items (org_id, code, name_en, section_id, unit, default_unit_cost)
              values (${ORG_A_ID}, 'MKT-raw.steel.dbtest_rebar', 'The studio''s own rebar', ${section.id}, 'ton', '1')`;
    await sql`insert into cost_items (org_id, code, name_ar, section_id, unit) values (${ORG_A_ID}, 'OWN-CLASH', 'سلك لفة 100 م', ${section.id}, 'roll')`;
    expect(await seedCommand(ORGS)).toBe(0);
    expect(printed.join('\n')).toMatch(/code clash 1, name clash 1/);
    const [own] = await sql`select name_en, default_unit_cost::text as cost, market_item_id from cost_items where org_id = ${ORG_A_ID} and code = 'MKT-raw.steel.dbtest_rebar'`;
    expect(own).toEqual({ name_en: "The studio's own rebar", cost: '1.0000', market_item_id: null });
    expect((await seededIn(ORG_B_ID)).map((row) => row.code)).toHaveLength(3);
  });

  it('keeps each studio in its own rows (RLS): org B sees none of org A seeded items', async () => {
    expect(await seedCommand(['--org', ORG_A_ID])).toBe(0);
    const visible = await sql.begin(async (tx) => {
      await tx`select set_config('app.current_org_id', ${ORG_B_ID}, true), set_config('app.current_user_id', ${USER_B_ID}, true)`;
      await tx.unsafe('set local role metra_app');
      return tx`select count(*)::int as n from cost_items where code like 'MKT-%'`;
    });
    expect(visible).toEqual([{ n: 0 }]);
    expect(await seededIn(ORG_A_ID)).toHaveLength(3);
  });

  it('rolls a failing studio back completely and still seeds the others; exit 1', async () => {
    breakPlan.on = true;
    expect(await seedCommand(['--org', ORG_A_ID])).toBe(1);
    expect(printed.join('\n')).toContain('FAILED, nothing written for this studio');
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    expect(await sql`select id from sections where org_id = ${ORG_A_ID} and key like 'market.%'`).toEqual([]);
    breakPlan.on = false;
    expect(await seedCommand(['--org', ORG_A_ID])).toBe(0);
    expect(await seededIn(ORG_A_ID)).toHaveLength(3);
  });

  it('refuses an --org that is not a uuid or not an organization', async () => {
    await expect(seedCommand(['--org', 'acme'])).rejects.toThrow('--org takes an organization id');
    await expect(seedCommand(['--org', '00000000-0000-4000-8000-0000000000ff'])).rejects.toThrow('no organization');
  });
});
