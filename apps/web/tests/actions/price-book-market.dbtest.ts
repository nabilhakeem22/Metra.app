import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { searchMarketLinksCore } from '@/lib/market-book/link-search';
import { readMarketColumn } from '@/lib/market-book/price-refs';
import { listPriceBookPage } from '@/lib/price-book/page-query';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw, seedBulletin, seedMarketItem } from './market-fixture';
import { rebuildSeedBook } from './market-seed-fixture';

// Market plan task 18 (Stage 2 PR B3.3): the price book's Market column (AC 15)
// and the link combobox's search. Market periods sit in 2094, apart from every
// other suite's; every market row is removed afterwards.

const orgIds: string[] = [];
let owner: OrgContext;
let manager: OrgContext;
let stranger: OrgContext;
let tile: { id: string };
let rebar: { id: string };
let unpriced: { id: string };

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId, other.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  manager = ctxFor(studio.orgId, studio.memberIds[0], 'project_manager');
  stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
  tile = await seedMarketItem('sqm', { nameAr: 'بلاط بورسلين', nameEn: 'Porcelain tile B3' });
  rebar = await seedMarketItem('ton', { nameAr: 'حديد', nameEn: 'Rebar B3' });
  unpriced = await seedMarketItem('sqm', { nameAr: 'رخام', nameEn: 'Marble B3' });
  await seedBulletin('2094-05', [[tile.id, '2094-05', '380'], [rebar.id, '2094-05', '38200']]);
  await seedBulletin('2094-06', [[tile.id, '2094-06', '400'], [unpriced.id, '2094-06', null]]);
  await rebuildSeedBook();
  const sectionId = await raw.sectionId(studio.orgId);
  // The pcs item linked to a sqm market item is a tamper no core allows (the link refuses it).
  await marketRaw()`
    insert into public.cost_items (org_id, section_id, code, name_en, unit, default_unit_cost, default_unit_price, market_item_id)
    values (${studio.orgId}, ${sectionId}, 'B3-TILE', 'Tile', 'sqm', 420, 450, ${tile.id}),
           (${studio.orgId}, ${sectionId}, 'B3-PCS', 'Tile piece', 'pcs', 4, 5, ${tile.id}),
           (${studio.orgId}, ${sectionId}, 'B3-MARBLE', 'Marble', 'sqm', 900, 950, ${unpriced.id}),
           (${studio.orgId}, ${sectionId}, 'B3-OWN', 'Own item', 'sqm', 10, 12, null)`;
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

const page = () => listPriceBookPage(owner, { sectionId: null, activeOnly: false, query: 'B3', page: 1 }, 'en');
const idOf = async (code: string) => (await page()).rows.find((row) => row.code === code)?.id as string;

describe('readMarketColumn (AC 15)', () => {
  it('prices a linked sqm item at 400 against its cost of 420 as +5.0%, with the market month', async () => {
    const book = await page();
    const column = await readMarketColumn(owner, book.rows);
    expect(column.bulletin).not.toBeNull();
    expect(column.refs[await idOf('B3-TILE')]).toMatchObject({
      marketItemId: tile.id, nameEn: 'Porcelain tile B3', unit: 'sqm', price: '400.0000', month: '2094-06', variancePct: '5.0', reason: 'ok',
    });
  });

  it('has no figure across units, none without a price, and nothing for an unlinked item', async () => {
    const book = await page();
    const column = await readMarketColumn(owner, book.rows);
    expect(column.refs[await idOf('B3-PCS')]).toMatchObject({ reason: 'unit_mismatch', variancePct: null });
    expect(column.refs[await idOf('B3-MARBLE')]).toMatchObject({ reason: 'no_price', price: null, month: null });
    expect(column.refs[await idOf('B3-OWN')]).toBeUndefined();
  });
});

describe('searchMarketLinksCore', () => {
  it("offers only active items in the cost item's own unit, matched by every word", async () => {
    const ownId = await idOf('B3-OWN');
    const found = await searchMarketLinksCore(owner, { costItemId: ownId, query: 'B3' });
    expect(found.data?.items.map((item) => item.id).sort()).toEqual([tile.id, unpriced.id].sort());
    expect(found.data?.items.find((item) => item.id === tile.id)).toMatchObject({ nameEn: 'Porcelain tile B3', unitCost: '400.0000' });
    const narrowed = await searchMarketLinksCore(owner, { costItemId: ownId, query: 'بورسلين b3' });
    expect(narrowed.data?.items.map((item) => item.id)).toEqual([tile.id]);
  });

  it('refuses a role that cannot link, another studio, and a forged input', async () => {
    const ownId = await idOf('B3-OWN');
    expect(await searchMarketLinksCore(manager, { costItemId: ownId, query: '' })).toEqual({ ok: false, error: 'forbidden' });
    expect(await searchMarketLinksCore(stranger, { costItemId: ownId, query: '' })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await searchMarketLinksCore(owner, { costItemId: randomUUID(), query: '' })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await searchMarketLinksCore(owner, { costItemId: ownId, query: 7 })).toEqual({ ok: false, error: 'malformed' });
  });
});
