// Helpers for the market-seed DB tests: a small published market book that
// covers every seed path, the REAL sign-up path (createOrgCore, then the seed
// request the onboarding wizard fires), and the owner's CLI on a twin studio.
import { randomUUID } from 'node:crypto';
import { createDb } from '@metra/db';
import { expect } from 'vitest';
import { seedNewStudioCore } from '@/lib/market-book/seed-core';
import { createOrgCore } from '@/lib/org/core';
import { rebuildSeedBook as rebuildStoredBook } from '../../../../packages/market-ingest/src/seed/book-store';
import { runSeed } from '../../../../packages/market-ingest/src/seed/run';
import { ctxFor, raw } from './fixture';
import { clearMarket, marketRaw, seedBulletin, seedMarketItem } from './market-fixture';

/** A studio created by createOrgCore alone: no seed scheduled (the CLI's twin). */
export async function createStudio(orgIds: string[], name: string) {
  const ctx = ctxFor(randomUUID(), randomUUID(), 'owner');
  orgIds.push(ctx.orgId);
  const result = await createOrgCore(ctx, { nameEn: name });
  expect(result.ok).toBe(true);
  return ctx;
}

/** A sign-up: the studio, then the seed request the wizard fires once it exists; its answer. */
export async function signUp(orgIds: string[], name: string) {
  const ctx = await createStudio(orgIds, name);
  return { ctx, seeded: await seedNewStudioCore(ctx) };
}

/** Five items: two seeded (one a roll, named with its pack), and a bag, a never-priced and a discontinued one skipped. */
export async function publishSeedFixture(): Promise<void> {
  const glass = await seedMarketItem('sqm', { nameAr: 'زجاج بذر الاختبار', nameEn: 'Seed test glass' });
  const wire = await seedMarketItem('roll', { nameAr: 'سلك بذر الاختبار', nameEn: 'Seed test wire', packLengthM: 100 });
  const bag = await seedMarketItem('bag', { nameAr: 'أسمنت بذر الاختبار', nameEn: 'Seed test cement' });
  const never = await seedMarketItem('pcs', { nameAr: 'فاصل بذر الاختبار', nameEn: 'Seed test joint' });
  const old = await seedMarketItem('pcs', { nameAr: 'ركيزة بذر الاختبار', nameEn: 'Seed test bearing', status: 'discontinued' });
  await seedBulletin('2000-02', [
    [glass.id, '2000-01', '450'], [glass.id, '2000-02', '467'], [wire.id, '2000-02', '30.455'],
    [bag.id, '2000-02', '100'], [never.id, '2000-02', null], [old.id, '2000-02', '12'],
  ]);
}

/** The owner's connection, as `market:seed-price-books` opens it. */
function ownerConnection() {
  return createDb(process.env.DATABASE_URL as string, { max: 1 });
}

/** Rebuild the stored seed book from what is published, as market:rebuild-seed-book does. */
export async function rebuildSeedBook(): Promise<void> {
  const { sql } = ownerConnection();
  try {
    await rebuildStoredBook(sql);
  } finally {
    await sql.end();
  }
}

/** `market:seed-price-books --org <orgId>` (a real run). */
export async function cliSeed(orgId: string): Promise<void> {
  const { db, sql } = ownerConnection();
  try {
    const run = await runSeed(db, sql, { dryRun: false, orgIds: [orgId] });
    expect(run.outcomes.map((outcome) => outcome.status)).toEqual(['seeded']);
  } finally {
    await sql.end();
  }
}

/** Every seeded item of the studio, with its section, in code order: what two studios must share. */
export function seededRows(orgId: string) {
  return raw.query(`
    select c.code, c.name_ar, c.name_en, c.unit::text as unit, c.default_unit_cost::text as cost,
           c.default_unit_price::text as price, c.market_item_id, c.active, s.key as section_key,
           s.name_ar as section_ar, s.name_en as section_en
      from cost_items c join sections s on s.id = c.section_id
     where c.org_id = '${orgId}' and c.market_item_id is not null order by c.code`);
}

/** The audit trail of the seed, without what differs by studio (ids, the source marker). */
export function seedAudits(orgId: string) {
  return raw.query(`
    select entity, action, after - 'section_id' - 'source' as after, after->>'source' as source
      from audit_log where org_id = '${orgId}' and after ? 'source' order by entity, after->>'code', after->>'key'`);
}

/** Removes the fixture's market rows (their seed-book rows go with them) and rebuilds the book from what is left. */
export async function clearSeedFixture(): Promise<void> {
  await clearMarket();
  await rebuildSeedBook();
}

export async function emptySeedBook(): Promise<void> {
  await marketRaw()`delete from public.market_seed_book`;
}

/** What an empty book means right now: a bulletin is published (the book is being built), or none is. */
export async function emptyBookState(): Promise<'preparing' | 'unpublished'> {
  const [row] = await marketRaw()`select exists (select 1 from public.market_bulletins where status = 'published') as published`;
  return row.published ? 'preparing' : 'unpublished';
}

/** Make a studio look as if it signed up `hours` ago. */
export async function ageStudio(orgId: string, hours: number): Promise<void> {
  await marketRaw()`update public.organizations set created_at = now() - make_interval(hours => ${hours}) where id = ${orgId}`;
}

/** The audit source markers of the studio's seed, one per row. */
export async function seedSources(orgId: string): Promise<string[]> {
  const rows = await raw.query<{ source: string }>(`select distinct after->>'source' as source from audit_log where org_id = '${orgId}' and after ? 'source'`);
  return rows.map((row) => row.source);
}
