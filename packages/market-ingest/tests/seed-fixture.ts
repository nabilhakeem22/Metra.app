// The seed DB tests' market fixture and helpers. The tests must hold on a
// database that ALREADY has a published bulletin (a local copy of production,
// say), so they never assume an empty market book: their market items carry
// `dbtest_` keys and names no bulletin prints, and their assertions are on
// those items, or on the difference the fixture makes to a run's counts.
import { ORG_A_ID, ORG_B_ID } from '@metra/db';
import { createDb } from '@metra/db/client';
import { runSeed, type StudioOutcome } from '../src/seed/run';
import type { SeedPlan } from '@metra/db/market-seed';
import { openTestDatabase, seedPublished } from './db-fixture';

export const sql = openTestDatabase();
export const STUDIOS = [ORG_A_ID, ORG_B_ID];

export async function publishFixture(): Promise<void> {
  await seedPublished(sql, '2003-09', [
    { key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', nameAr: 'حديد اختبار البذر', nameEn: 'Seed test rebar', prices: [['2003-08', '38200'], ['2003-09', '39850']] },
    { key: 'raw.steel.dbtest_wire', unit: 'roll', sourceLabel: 'سلك اختبار', nameAr: 'سلك اختبار البذر', nameEn: 'Seed test wire', pack: { lengthM: 100, pieces: null, pieceLengthM: null }, prices: [['2003-09', '30.455']] },
    { key: 'raw.steel.dbtest_bags', unit: 'bag', sourceLabel: 'شيكارة اختبار', nameAr: 'أسمنت اختبار البذر', nameEn: 'Seed test cement', prices: [['2003-09', '100']] },
    { key: 'raw.steel.dbtest_stamped', unit: 'pcs', sourceLabel: 'ركيزة اختبار', nameAr: 'ركيزة اختبار البذر', nameEn: 'Seed test bearing', prices: [['2003-08', '8721'], ['2003-09', null]] },
    { key: 'raw.steel.dbtest_never', unit: 'pcs', sourceLabel: 'فاصل اختبار', nameAr: 'فاصل اختبار البذر', nameEn: 'Seed test joint', prices: [['2003-09', null]] },
  ]);
}

/** Removes everything a seed run wrote (test database only). */
export async function clearSeeded(): Promise<void> {
  await sql`delete from audit_log where after->>'source' = 'market:seed-price-books'`;
  await sql`delete from cost_items where code like 'MKT-%' or code like 'OWN-%'`;
  await sql`delete from sections where key like 'market.%'`;
}

/** One run, structured (the CLI prints the same outcomes). */
export async function run(dryRun: boolean, orgIds = STUDIOS): Promise<StudioOutcome[]> {
  const { db, sql: connection } = createDb(process.env.DATABASE_URL as string, { max: 1 });
  try {
    return (await runSeed(db, connection, { dryRun, orgIds })).outcomes;
  } finally {
    await connection.end();
  }
}

export function planOf(outcomes: StudioOutcome[], orgId: string): SeedPlan {
  const outcome = outcomes.find((candidate) => candidate.studio.id === orgId);
  if (!outcome || !('plan' in outcome)) throw new Error(`no plan for ${orgId}: ${JSON.stringify(outcome)}`);
  return outcome.plan;
}

/** The plan restricted to the fixture's items, so other published data cannot move the numbers. */
export function fixtureItems(plan: SeedPlan) {
  return plan.itemsToCreate.filter((item) => item.code.startsWith('MKT-raw.steel.dbtest_'));
}

export const seededIn = (orgId: string) => sql<Array<{ code: string; name_ar: string; unit: string; cost: string; price: string; market: boolean; active: boolean; section_key: string | null }>>`
  select c.code, c.name_ar, c.unit, c.default_unit_cost::text as cost, c.default_unit_price::text as price,
         c.market_item_id is not null as market, c.active, s.key as section_key
    from cost_items c join sections s on s.id = c.section_id
   where c.org_id = ${orgId} and c.code like 'MKT-raw.steel.dbtest_%' order by c.code`;
