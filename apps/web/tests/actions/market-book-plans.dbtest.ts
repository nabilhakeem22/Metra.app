import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { CATEGORY_COUNTS, marketBookPageSql } from '@/lib/market-book/page-sql';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw, seedBulletin, seedMarketItem } from './market-fixture';
import { rebuildSeedBook } from './market-seed-fixture';

// The read path's plan shape (R2). The market policies wrap the org-context
// test and `app_is_current_org_member()` in `(select ...)`, so the planner
// runs them ONCE per query as an InitPlan. Called bare, the membership
// function sat in the Filter of every observation row and made the C4 series
// read 7 to 14x slower, growing with every bulletin. These pin both halves:
// the function never appears in a per-row filter, and the month bound stays an
// index condition when it is bound as a `date` (R5: computed as a timestamp in
// SQL, the bound fell out of the index). `enable_seqscan` is off because a
// fixture this small would otherwise be read by a sequential scan whatever the
// policies say; the question here is what the planner CAN do.

const orgIds: string[] = [];
let ctx: OrgContext;
let itemId: string;

beforeAll(async () => {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  ctx = ctxFor(orgId, ownerIds[0], 'owner');
  const item = await seedMarketItem();
  itemId = item.id;
  await seedBulletin('2002-06', [[item.id, '2002-05', '100'], [item.id, '2002-06', '110']]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

async function plan(query: ReturnType<typeof sql>): Promise<string> {
  return withOrgContext(ctx, async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    const rows = await tx.execute(sql`explain ${query}`);
    return (rows as unknown as Array<{ 'QUERY PLAN': string }>).map((row) => row['QUERY PLAN']).join('\n');
  });
}

describe('the market read path as metra_app', () => {
  it('evaluates the membership check once (InitPlan), never per row, on the C4 series read', async () => {
    const text = await plan(sql`
      select distinct on (o.item_id, o.period_month) o.item_id, o.period_month, o.status, o.price, b.period_month as bulletin_month
        from public.market_price_observations o
        join public.market_bulletins b on b.id = o.bulletin_id and b.status = 'published'
       where o.item_id = ${itemId} and o.period_month >= ${'2001-06-01'}::date
       order by o.item_id, o.period_month, b.period_month desc`);
    expect(text).toContain('InitPlan');
    expect(text).not.toContain('app_is_current_org_member');
    expect(text).toMatch(/Index Cond: .*period_month >= /);
  });

  it('reads the newest priced month and the seeded names of each page row by index, one item at a time', async () => {
    const text = await plan(marketBookPageSql({ categoryKey: null, query: '', page: 1 }, 'en'));
    expect(text).toMatch(/Index Cond: \(item_id = ANY \(ARRAY\[i(_\d+)?\.id\]\)\)/);
    expect(text).toMatch(/Index Scan using market_seed_book_pkey on market_seed_book seeded/);
  });

  it('counts each leaf from the seed book, never reading the observation history, and falls back to the items before the book is built', async () => {
    await rebuildSeedBook();
    const counted = () => withOrgContext(ctx, (tx) => tx.execute(sql`select category_id, n from (${CATEGORY_COUNTS}) k order by 1`));
    const itemCounts = () => withOrgContext(ctx, (tx) => tx.execute(sql`select category_id, count(*)::int as n from market_items group by 1 order by 1`));
    const analyzed = await withOrgContext(ctx, async (tx) => {
      const rows = await tx.execute(sql`explain (analyze, costs off) select * from (${CATEGORY_COUNTS}) k`);
      return (rows as unknown as Array<{ 'QUERY PLAN': string }>).map((row) => row['QUERY PLAN']);
    });
    const historyReads = analyzed.filter((line) => line.includes('market_price_observations'));
    expect(historyReads.length).toBeGreaterThan(0);
    expect(historyReads.every((line) => line.includes('(never executed)'))).toBe(true);
    expect(await counted()).toEqual(await itemCounts());
    await marketRaw()`delete from public.market_seed_book`;
    expect(await counted()).toEqual(await itemCounts());
  });

  it('does the same on the item and details reads', async () => {
    for (const table of ['market_items', 'market_item_details', 'market_categories', 'market_bulletins']) {
      const text = await plan(sql.raw(`select * from public.${table}`));
      expect(text, table).not.toContain('app_is_current_org_member');
    }
  });
});
