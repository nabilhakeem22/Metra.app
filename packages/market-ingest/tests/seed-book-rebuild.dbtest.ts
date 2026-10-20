import { MARKET_WRITE_LOCK } from '@metra/db/market-seed';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rebuildSeedBook } from '../src/seed/book-store';
import { readMarketSeedItems } from '../src/seed/read';
import { clearMarketTestData, openTestDatabase, seedPublished } from './db-fixture';
import { clearSeeded, publishFixture, sql } from './seed-fixture';

// R2: the seed book's rebuild held the market write lock (which every studio's
// add and sign-up seed waits on) for its whole read, a DISTINCT ON over every
// observation of every bulletin: 2 s at 121 bulletins. The read now stops at
// each item's newest priced month, and a rebuild reads and builds BEFORE the
// lock, keeping what it built only when no bulletin moved meanwhile.

const reads = vi.hoisted(() => ({ calls: 0, afterFirst: async (): Promise<void> => undefined }));
vi.mock('../src/seed/read', async (original) => {
  const real = await original<typeof import('../src/seed/read')>();
  return {
    ...real,
    readMarketSeedItems: async (...args: Parameters<typeof real.readMarketSeedItems>) => {
      const items = await real.readMarketSeedItems(...args);
      reads.calls += 1;
      if (reads.calls === 1) await reads.afterFirst();
      return items;
    },
  };
});

/** A second session: a publish or withdrawal running beside the rebuild. */
const other = openTestDatabase();

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await publishFixture();
  reads.calls = 0;
  reads.afterFirst = async () => undefined;
});

afterAll(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await rebuildSeedBook(sql);
  await other.end();
  await sql.end();
});

/** The read's definition as it was: one row per (item, month) from the newest published bulletin reporting it, then each item's newest priced one. */
const effectiveLatestPrices = () => sql<Array<{ id: string; latest_price: string | null }>>`
  with effective as (
    select distinct on (o.item_id, o.period_month) o.item_id, o.period_month, o.status, o.price
      from market_price_observations o
      join market_bulletins b on b.id = o.bulletin_id and b.status = 'published'
     order by o.item_id, o.period_month, b.period_month desc
  ), latest as (
    select distinct on (item_id) item_id, price from effective where status = 'priced' order by item_id, period_month desc
  )
  select i.id, l.price::text as latest_price
    from market_items i left join latest l on l.item_id = i.id
   where exists (select 1 from effective e where e.item_id = i.id)`;

const fixtureBook = () => sql<Array<{ code: string; cost: string | null }>>`
  select code, unit_cost::text as cost from market_seed_book where code like 'MKT-raw.steel.dbtest_%' order by code`;

const withdraw = (bulletinId: string) => sql`update market_bulletins set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = 'dbtest' where id = ${bulletinId}`;

describe('readMarketSeedItems', () => {
  it('prices each item at its newest effective priced month, as the DISTINCT ON over every observation did', async () => {
    // 2003-10 restates September and suspends October; 2003-11 prices November, then is withdrawn; one item only it printed.
    await seedPublished(sql, '2003-10', [
      { key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', prices: [['2003-09', '39900'], ['2003-10', null]] },
      { key: 'raw.steel.dbtest_never', unit: 'pcs', sourceLabel: 'فاصل اختبار', prices: [['2003-10', '12']] },
    ]);
    const november = await seedPublished(sql, '2003-11', [
      { key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', prices: [['2003-11', '50000']] },
      { key: 'raw.steel.dbtest_gone', unit: 'ton', sourceLabel: 'بند مسحوب', prices: [['2003-11', '1']] },
    ]);
    await withdraw(november);
    const read = (await readMarketSeedItems(sql)).map((item) => ({ id: item.id, latest_price: item.latestPrice }));
    expect(read.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...(await effectiveLatestPrices())].sort((a, b) => a.id.localeCompare(b.id)));
    const byKey = new Map((await readMarketSeedItems(sql)).map((item) => [item.key, item.latestPrice]));
    expect([byKey.get('raw.steel.dbtest_rebar'), byKey.get('raw.steel.dbtest_never'), byKey.has('raw.steel.dbtest_gone')]).toEqual(['39900.0000', '12.0000', false]);
  });
});

describe('rebuildSeedBook builds before it takes the market write lock', () => {
  it('reads and builds while a publish holds the lock, and swaps the book in once it may', async () => {
    let release: () => void = () => undefined;
    const publishing = other.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
      await new Promise<void>((resolve) => (release = resolve));
    });
    await vi.waitFor(async () => {
      const [{ held }] = await sql<Array<{ held: boolean }>>`
        select exists (select 1 from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock') as held`;
      expect(held).toBe(true);
    });
    const rebuilt = rebuildSeedBook(sql);
    await vi.waitFor(() => expect(reads.calls).toBe(1));
    release();
    await publishing;
    expect((await rebuilt).entries.length).toBeGreaterThan(0);
    expect(reads.calls).toBe(1);
    expect((await fixtureBook()).find((row) => row.code === 'MKT-raw.steel.dbtest_rebar')?.cost).toBe('39850.0000');
  });

  it('builds again under the lock when a bulletin was published after its read, so the stored book has it', async () => {
    reads.afterFirst = async () => {
      await seedPublished(other, '2003-10', [{ key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', prices: [['2003-10', '41000']] }]);
    };
    await rebuildSeedBook(sql);
    expect(reads.calls).toBe(2);
    expect((await fixtureBook()).find((row) => row.code === 'MKT-raw.steel.dbtest_rebar')?.cost).toBe('41000.0000');
  });

  it('builds again when a bulletin was withdrawn after its read', async () => {
    const october = await seedPublished(sql, '2003-10', [{ key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', prices: [['2003-10', '41000']] }]);
    await rebuildSeedBook(sql);
    reads.calls = 0;
    reads.afterFirst = async () => void (await other`update market_bulletins set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = 'dbtest' where id = ${october}`);
    await rebuildSeedBook(sql);
    expect(reads.calls).toBe(2);
    expect((await fixtureBook()).find((row) => row.code === 'MKT-raw.steel.dbtest_rebar')?.cost).toBe('39850.0000');
  });
});
