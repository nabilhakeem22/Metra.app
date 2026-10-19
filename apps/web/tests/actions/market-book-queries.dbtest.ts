import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { marketBookPageSql } from '@/lib/market-book/page-sql';
import { readMarketBookPage, readMarketItem } from '@/lib/market-book/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw, seedBulletin, seedMarketItem, withdrawBulletin } from './market-fixture';

// The studio's market reads (plan task 15). Periods sit in 2099, after any real
// bulletin a local database may hold, so "the newest published bulletin" is this
// suite's; a unique word in the names makes a search return this suite's items
// only. Every bulletin and item is removed by closeMarketFixture.

const TAG = `zq${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const orgIds: string[] = [];
let studio: OrgContext;
let otherStudio: OrgContext;
let glass: { id: string; key: string };
let rebar: { id: string; key: string };
let august: string;

beforeAll(async () => {
  const a = await seedOrg({ owners: 1 });
  const b = await seedOrg({ owners: 1 });
  orgIds.push(a.orgId, b.orgId);
  studio = ctxFor(a.orgId, a.ownerIds[0], 'owner');
  otherStudio = ctxFor(b.orgId, b.ownerIds[0], 'owner');
  glass = await seedMarketItem('sqm', { nameEn: `Clear glass ${TAG}`, specEn: '4 mm' });
  rebar = await seedMarketItem('ton', { nameEn: `Rebar ${TAG}` });
  await seedBulletin('2099-07', [[glass.id, '2099-06', '100'], [glass.id, '2099-07', '110'], [rebar.id, '2099-06', '38200'], [rebar.id, '2099-07', '39850']]);
  august = await seedBulletin('2099-08', [[glass.id, '2099-06', '105'], [glass.id, '2099-07', '110'], [glass.id, '2099-08', '121'], [rebar.id, '2099-08', null]]);
  const sectionId = await raw.sectionId(studio.orgId);
  await marketRaw()`insert into public.cost_items (org_id, code, name_en, section_id, unit, market_item_id)
                    values (${studio.orgId}, 'MY-GLASS', 'My glass', ${sectionId}, 'sqm', ${glass.id})`;
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

const search = (ctx: OrgContext) => readMarketBookPage(ctx, { categoryKey: null, query: TAG }, 'en');

describe('readMarketBookPage', () => {
  it('reads the newest published bulletin and each item effective series, newest bulletin winning', async () => {
    const page = await search(studio);
    expect(page.bulletin?.periodMonth).toBe('2099-08');
    expect(page.categoryKey).toBeNull();
    expect(page.matched).toBe(2);
    const [first, second] = page.items;
    expect(first.id).toBe(glass.id);
    expect(first.series.map((point) => [point.month, point.price, point.bulletinMonth])).toEqual([
      ['2099-06', '105.0000', '2099-08'],
      ['2099-07', '110.0000', '2099-08'],
      ['2099-08', '121.0000', '2099-08'],
    ]);
    expect(first.momPct).toBe('10.0');
    expect(second.id).toBe(rebar.id);
    expect(second.latest).toMatchObject({ month: '2099-08', status: 'suspended', price: null });
    expect(second.momPct).toBeNull();
  });

  it('shows the studio its own linked item, and another studio nothing of it', async () => {
    const mine = (await search(studio)).items.find((item) => item.id === glass.id);
    expect(mine?.linkedCostItem?.code).toBe('MY-GLASS');
    const theirs = (await search(otherStudio)).items.find((item) => item.id === glass.id);
    expect(theirs?.linkedCostItem).toBeNull();
  });

  it('lists a leaf with its count, and reads an unknown leaf as the first leaf that has items', async () => {
    const page = await readMarketBookPage(studio, { categoryKey: 'finishing.glass', query: '' }, 'ar-EG');
    expect(page.categoryKey).toBe('finishing.glass');
    expect(page.items.map((item) => item.id)).toEqual(expect.arrayContaining([glass.id, rebar.id]));
    const leaf = page.categories.find((category) => category.key === 'finishing.glass');
    const top = page.categories.find((category) => category.key === 'finishing');
    expect(leaf?.itemCount).toBe(page.matched);
    expect(top?.itemCount).toBeGreaterThanOrEqual(leaf?.itemCount ?? Infinity);
    const fallback = await readMarketBookPage(studio, { categoryKey: 'nothing.here', query: '' }, 'en');
    const firstLeaf = fallback.categories.find((category) => category.parentKey !== null && category.itemCount > 0);
    expect(fallback.categoryKey).toBe(firstLeaf?.key);
  });

  it('keeps the series month bound an index condition on the real statement (R5)', async () => {
    const plan = await withOrgContext(studio, async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = await tx.execute(sql`explain ${marketBookPageSql({ categoryKey: null, query: TAG }, 'en')}`);
      return (rows as unknown as Array<{ 'QUERY PLAN': string }>).map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toMatch(/Index Cond: \(\(item_id = .*\) AND \(period_month >= /);
    // The market policies run their membership check once (market-book-plans.dbtest.ts);
    // the one per-row call left is cost_items' own org policy, on at most one linked row per item.
    const perRow = plan.split('\n').filter((line) => line.includes('Filter:') && line.includes('app_is_current_org_member'));
    expect(perRow).toEqual([expect.stringContaining('market_item_id = ')]);
  });
});

describe('readMarketItem', () => {
  it('reads every effective month for the drawer, and nothing for an unknown id', async () => {
    const item = await readMarketItem(studio, glass.id);
    expect(item?.allPoints.map((point) => point.month)).toEqual(['2099-06', '2099-07', '2099-08']);
    expect(item?.allPoints[0].sourcePage).toBe(1);
    expect(item?.linkedCostItem?.code).toBe('MY-GLASS');
    expect(await readMarketItem(studio, randomUUID())).toBeNull();
  });
});

describe('a withdrawal', () => {
  it('falls back to the previous bulletin in the same read, page and drawer alike', async () => {
    await withdrawBulletin(august);
    const page = await search(studio);
    expect(page.bulletin?.periodMonth).toBe('2099-07');
    const [first, second] = page.items;
    expect(first.series.map((point) => [point.month, point.price])).toEqual([['2099-06', '100.0000'], ['2099-07', '110.0000']]);
    expect(second.latest?.price).toBe('39850.0000');
    expect(second.momPct).toBe('4.3');
    expect((await readMarketItem(studio, glass.id))?.allPoints.map((point) => point.bulletinMonth)).toEqual(['2099-07', '2099-07']);
  });
});
