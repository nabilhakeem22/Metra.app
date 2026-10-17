import { rmSync } from 'node:fs';
import { MARKET_WRITE_LOCK, buildSeedBook } from '@metra/db/market-seed';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withdrawCommand } from '../src/commands/withdraw-command';
import { rebuildAndHoldSeedBook, releaseSeedBookHold } from '../src/seed/book-store';
import { readMarketSeedItems } from '../src/seed/read';
import { clearMarketTestData, openTestDatabase } from './db-fixture';
import { bulletinFile, newStaging, publish, stage, type Staging } from './publish-fixture';
import { clearSeeded, publishFixture, run, sql } from './seed-fixture';

// The stored seed book the app seeds new studios from (market_seed_book) says
// what the published book says: market:publish and market:withdraw rebuild it
// in their own transaction, and a real market:seed-price-books run stores
// exactly the book it seeded with; a dry run stores nothing.

vi.mock('../src/gate', async (original) => ({
  ...(await original<typeof import('../src/gate')>()),
  readGate: () => ({ commit: 'f'.repeat(40), changedFiles: [] }),
}));

let staging: Staging;

const stored = () => sql<Array<{ code: string; name_ar: string; name_en: string; unit: string | null; cost: string | null; price: string | null; status: string; name_forms: string[] }>>`
  select code, name_ar, name_en, unit::text as unit, unit_cost::text as cost, unit_price::text as price, status::text as status, name_forms
    from market_seed_book order by position`;
const storedFixture = async () => (await stored()).filter((row) => row.code.startsWith('MKT-raw.steel.dbtest_'));

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  staging = newStaging();
  vi.stubEnv('MARKET_STAGING_DIR', staging.dir);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  rmSync(staging.dir, { recursive: true, force: true });
  await clearSeeded();
  await clearMarketTestData(sql);
  await sql.end();
});

describe('market:publish and market:withdraw rebuild the seed book', () => {
  it('a publish adds the bulletin items with their seeded names and prices; its withdrawal takes them out', async () => {
    expect(await publish(staging, '2004-07', await stage(staging, bulletinFile(staging)))).toBe(0);
    const book = await storedFixture();
    expect(book.length).toBeGreaterThan(0);
    expect(book.find((row) => row.code === 'MKT-raw.steel.dbtest_rebar')).toMatchObject({ unit: 'ton', status: 'active' });
    expect(await withdrawCommand(['--period', '2004-07', '--reason', 'wrong file'])).toBe(0);
    expect(await storedFixture()).toEqual([]);
  });

  it('a corrected --replace corrects the names the book seeds with', async () => {
    expect(await publish(staging, '2004-07', await stage(staging, bulletinFile(staging)))).toBe(0);
    const corrected = await stage(staging, bulletinFile(staging, { nameEn: 'Corrected name' }));
    expect(await publish(staging, '2004-07', corrected, ['--replace'])).toBe(0);
    expect((await storedFixture()).find((row) => row.code === 'MKT-raw.steel.dbtest_rebar')?.name_en).toContain('Corrected name');
  });
});

describe('market:seed-price-books and the stored book', () => {
  it('holds the stored book against any publish or withdrawal from its rebuild until it is released', async () => {
    const seeding = openTestDatabase();
    const tryPublish = async () => (await sql`select pg_try_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK})) as got`)[0].got as boolean;
    try {
      await rebuildAndHoldSeedBook(seeding);
      expect(await tryPublish()).toBe(false);
      await releaseSeedBookHold(seeding);
      expect(await tryPublish()).toBe(true);
    } finally {
      await seeding.end();
    }
  });

  it('a dry run stores nothing; a real run stores exactly the book it seeded with', async () => {
    await publishFixture();
    await run(true);
    expect(await storedFixture()).toEqual([]);
    await run(false);
    const expected = buildSeedBook(await readMarketSeedItems(sql)).map((entry) => ({
      code: entry.code, name_ar: entry.nameAr, name_en: entry.nameEn, unit: entry.unit, cost: entry.unitCost, price: entry.unitPrice,
      status: entry.status, name_forms: entry.nameForms,
    }));
    expect(await stored()).toEqual(expected);
    expect((await storedFixture()).map((row) => [row.code, row.unit, row.cost])).toEqual([
      ['MKT-raw.steel.dbtest_bags', null, '100.0000'],
      ['MKT-raw.steel.dbtest_never', 'pcs', null],
      ['MKT-raw.steel.dbtest_rebar', 'ton', '39850.0000'],
      ['MKT-raw.steel.dbtest_stamped', 'pcs', '8721.0000'],
      ['MKT-raw.steel.dbtest_wire', 'roll', '30.4550'],
    ]);
  });
});
