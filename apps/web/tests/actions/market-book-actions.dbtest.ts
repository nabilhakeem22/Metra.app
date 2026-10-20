import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { marketRowView } from '@/app/[locale]/(app)/market-book/market-row-view';
import { addMarketItemToPriceBookCore, linkCostItemToMarketCore } from '@/lib/market-book/core';
import { readMarketBookPage } from '@/lib/market-book/queries';
import type { OrgContext } from '@/lib/db/context';
import { COST_ITEM_CODE_MAX } from '@/lib/price-book/cost-item-input';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw, seedBulletin, seedMarketItem, type MarketLeaf } from './market-fixture';
import { rebuildSeedBook } from './market-seed-fixture';

// "Add to my price book" and the link (plan AC 11 to 13), and the fix round's
// rulings: the add gives an item exactly what the seed gives it (names, cost,
// cost x 1.05), the cost the page shows is the cost saved, and what the seed
// skips is refused. Periods sit in 2096 and 2097, apart from every other
// suite's, and every market row is removed afterwards.

const orgIds: string[] = [];
let owner: OrgContext;
let manager: OrgContext;
let sectionId: string;
let glass: { id: string; key: string };
let rebar: { id: string; key: string };
let cement: { id: string; key: string };
let old: { id: string; key: string };
let never: { id: string; key: string };

const CLAY_STANDARD: MarketLeaf = { key: 'finishing.dbtest_clay_standard', nameAr: 'فخار عادي', nameEn: 'Standard clay' };
const CLAY_FLEXIBLE: MarketLeaf = { key: 'finishing.dbtest_clay_flexible', nameAr: 'فخار مرن', nameEn: 'Flexible clay' };

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(studio.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  manager = ctxFor(studio.orgId, studio.memberIds[0], 'project_manager');
  sectionId = await raw.sectionId(studio.orgId);
  glass = await seedMarketItem('sqm', { nameAr: 'زجاج شفاف', nameEn: 'Clear glass', specAr: '4 مم', specEn: '4 mm' });
  rebar = await seedMarketItem('ton', { nameAr: 'حديد تسليح', nameEn: 'Rebar' });
  cement = await seedMarketItem('bag', { nameAr: 'أسمنت', nameEn: 'Cement' });
  old = await seedMarketItem('sqm', { nameAr: 'زجاج قديم', nameEn: 'Old glass' });
  never = await seedMarketItem('sqm', { nameAr: 'زجاج بلا سعر', nameEn: 'Never priced glass' });
  // Priced once, in a month older than the page's window (2097-06 back to 2096-06), then suspended.
  await seedBulletin('2096-01', [[old.id, '2096-01', '777']]);
  await seedBulletin('2097-05', [[glass.id, '2097-04', '380'], [glass.id, '2097-05', '390'], [rebar.id, '2097-05', '38200'], [cement.id, '2097-05', '90'],
    [old.id, '2097-05', null], [never.id, '2097-05', null]]);
  // The newer bulletin restates April, prices May anew and suspends rebar in June.
  await seedBulletin('2097-06', [[glass.id, '2097-05', '400'], [glass.id, '2097-06', null], [rebar.id, '2097-06', null], [old.id, '2097-06', null]]);
  await rebuildSeedBook();
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

const costItem = async (code: string) => {
  const [row] = await marketRaw()<Array<Record<string, string | null>>>`
    select id, unit::text, name_ar, name_en, default_unit_cost::text as cost, default_unit_price::text as price, market_item_id
      from public.cost_items where org_id = ${owner.orgId} and code = ${code}`;
  return row;
};
const seedBookRow = async (itemId: string) => {
  const [row] = await marketRaw()<Array<Record<string, string | null>>>`
    select name_ar, name_en, unit_cost::text as cost, unit_price::text as price from public.market_seed_book where item_id = ${itemId}`;
  return row;
};
const add = (code: string, marketItemId: string, extra: Record<string, string> = {}) =>
  addMarketItemToPriceBookCore(owner, { marketItemId, code, sectionId, ...extra });
const linkedCount = async (marketItemId: string) =>
  (await marketRaw()<Array<{ n: number }>>`select count(*)::int as n from public.cost_items where org_id = ${owner.orgId} and market_item_id = ${marketItemId}`)[0].n;

describe('addMarketItemToPriceBookCore (AC 11, 12)', () => {
  it('adds a sqm item at its latest effective priced value and cost x 1.05, linked, named as the seed names it, and audited', async () => {
    const audits = await raw.count('audit_log', owner.orgId);
    expect(await add('MKT-GLASS', glass.id)).toMatchObject({ ok: true });
    expect(await costItem('MKT-GLASS')).toMatchObject({
      unit: 'sqm', cost: '400.0000', price: '420.0000', market_item_id: glass.id, name_ar: 'زجاج شفاف 4 مم', name_en: 'Clear glass 4 mm',
    });
    expect(await raw.count('audit_log', owner.orgId)).toBe(audits + 1);
  });

  it('gives the item the seed book\'s names, cost and price, so the two paths never disagree (F2, F3)', async () => {
    const saved = await costItem('MKT-GLASS');
    expect({ name_ar: saved?.name_ar, name_en: saved?.name_en, cost: saved?.cost, price: saved?.price }).toEqual(await seedBookRow(glass.id));
  });

  it('adds a ton item as ton, skipping a suspended newest month for the price before it (D3)', async () => {
    expect(await add('MKT-REBAR', rebar.id, { defaultUnitPrice: '40,000', nameEn: 'Steel bars' })).toMatchObject({ ok: true });
    expect(await costItem('MKT-REBAR')).toMatchObject({ unit: 'ton', cost: '38200.0000', price: '40000.0000', name_en: 'Steel bars', name_ar: null });
  });

  it('saves the cost the page shows: an old price with its month, not 0 (F1, the tester\'s 0-shown, 777-saved case)', async () => {
    const page = await readMarketBookPage(owner, { categoryKey: 'finishing.glass', query: '', page: 1 }, 'en');
    const row = page.items.find((item) => item.id === old.id);
    expect(page.bulletin?.periodMonth).toBe('2097-06');
    expect(row?.series.every((point) => point.status === 'suspended')).toBe(true);
    const view = marketRowView(row!, page.bulletin!.periodMonth);
    expect(view.latestPriced).toEqual({ month: '2096-01', price: '777.0000' });
    expect(view.latestPricedIsOld).toBe(true);
    expect(await add('MKT-OLD', old.id)).toMatchObject({ ok: true });
    expect(await costItem('MKT-OLD')).toMatchObject({ cost: '777.0000', price: '815.8500' });
  });

  it('refuses an item no month ever priced, as the seed skips it, and writes nothing (F6)', async () => {
    const before = await raw.count('cost_items', owner.orgId);
    expect(await add('MKT-NEVER', never.id)).toEqual({ ok: false, error: 'market_item_unpriced' });
    expect(await raw.count('cost_items', owner.orgId)).toBe(before);
  });

  it('refuses a bag item, which has no studio unit, and writes nothing', async () => {
    const before = await raw.count('cost_items', owner.orgId);
    expect(await add('MKT-CEMENT', cement.id)).toEqual({ ok: false, error: 'market_unit_incompatible' });
    expect(await raw.count('cost_items', owner.orgId)).toBe(before);
  });

  it('says a taken code under the code field, and a bad price under the price field', async () => {
    const fresh = await seedMarketItem('sqm', { nameEn: 'Fresh glass' });
    await seedBulletin('2097-01', [[fresh.id, '2097-01', '12']]);
    expect(await add('MKT-GLASS', fresh.id, { nameEn: 'Fresh glass' })).toEqual({ ok: false, error: 'check_fields', fields: { code: { code: 'code_taken' } } });
    expect(await add('', glass.id, { defaultUnitPrice: '1,5' })).toEqual({
      ok: false, error: 'check_fields', fields: { code: { code: 'code_required' }, defaultUnitPrice: { code: 'not_a_number' } },
    });
  });

  it('refuses a discontinued or unknown item, and a role that cannot create', async () => {
    const gone = await seedMarketItem('sqm', { status: 'discontinued' });
    await seedBulletin('2097-04', [[gone.id, '2097-04', '10']]);
    expect(await add('MKT-GONE', gone.id)).toEqual({ ok: false, error: 'market_item_not_found' });
    expect(await add('MKT-NONE', '00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, error: 'market_item_not_found' });
    expect(await addMarketItemToPriceBookCore(manager, { marketItemId: glass.id, code: 'PM', sectionId })).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('a market item is added once (F4)', () => {
  it('refuses a second add under another code while the first is active, and allows one once it is archived', async () => {
    expect(await add('MKT-GLASS-2', glass.id)).toEqual({ ok: false, error: 'market_item_already_added' });
    expect(await linkedCount(glass.id)).toBe(1);
    await marketRaw()`update public.cost_items set active = false where org_id = ${owner.orgId} and code = 'MKT-GLASS'`;
    expect(await add('MKT-GLASS-2', glass.id)).toMatchObject({ ok: true });
    expect(await add('MKT-GLASS-3', glass.id)).toEqual({ ok: false, error: 'market_item_already_added' });
  });

  it('lets exactly one of three concurrent adds through (the studio lock the seed takes)', async () => {
    const tiles = await seedMarketItem('sqm', { nameAr: 'بلاط سباق', nameEn: 'Race tiles' });
    await seedBulletin('2097-03', [[tiles.id, '2097-03', '55']]);
    await rebuildSeedBook();
    const results = await Promise.all(['RACE-A', 'RACE-B', 'RACE-C'].map((code) => add(code, tiles.id)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: 'market_item_already_added' },
      { ok: false, error: 'market_item_already_added' },
    ]);
    expect(await linkedCount(tiles.id)).toBe(1);
  });
});

describe('an added item is named exactly as the seed names it (F2)', () => {
  it('two items that print alike carry their sub-category, a roll its pack, and « - » reads «، »', async () => {
    const standard = await seedMarketItem('pcs', { nameAr: 'كوع فخار', nameEn: 'Clay bend', specAr: '175 مم', specEn: '175 mm', leaf: CLAY_STANDARD });
    const flexible = await seedMarketItem('pcs', { nameAr: 'كوع فخار', nameEn: 'Clay bend', specAr: '175 مم', specEn: '175 mm', leaf: CLAY_FLEXIBLE });
    const roll30 = await seedMarketItem('roll', { nameAr: 'خراطيم بولي اثيلين', nameEn: 'PE conduit', specAr: '13 مم', specEn: '13 mm', packLengthM: 30 });
    const roll45 = await seedMarketItem('roll', { nameAr: 'خراطيم بولي اثيلين', nameEn: 'PE conduit', specAr: '13 مم', specEn: '13 mm', packLengthM: 45 });
    const dashed = await seedMarketItem('sqm', { nameAr: 'رخام - تركي', nameEn: 'Marble - Turkish' });
    const items = { standard, flexible, roll30, roll45, dashed };
    await seedBulletin('2097-02', Object.values(items).map((item): [string, string, string] => [item.id, '2097-02', '20']));
    await rebuildSeedBook();
    for (const [code, item] of Object.entries(items)) expect(await add(`NAMED-${code}`, item.id)).toMatchObject({ ok: true });
    const named = Object.fromEntries(await Promise.all(Object.keys(items).map(async (code) => [code, (await costItem(`NAMED-${code}`))?.name_ar])));
    expect(named).toEqual({
      standard: 'كوع فخار 175 مم (فخار عادي)',
      flexible: 'كوع فخار 175 مم (فخار مرن)',
      roll30: 'خراطيم بولي اثيلين 13 مم لفة 30 م',
      roll45: 'خراطيم بولي اثيلين 13 مم لفة 45 م',
      dashed: 'رخام، تركي',
    });
    for (const [code, item] of Object.entries(items)) expect((await costItem(`NAMED-${code}`))?.name_en).toBe((await seedBookRow(item.id))?.name_en);
  });
});

describe('a name an own item of the studio already has (N2, the name-clash rule of the seed)', () => {
  it('is refused under that name with the code of that item, and a different typed name is added', async () => {
    const mirror = await seedMarketItem('sqm', { nameAr: 'مرايا فضية', nameEn: 'Silver mirror', specAr: '5 مم', specEn: '5 mm' });
    await seedBulletin('2096-12', [[mirror.id, '2096-12', '300']]);
    await rebuildSeedBook();
    await marketRaw()`insert into public.cost_items (org_id, code, name_en, section_id, unit)
                      values (${owner.orgId}, 'MY-MIRROR', 'silver  MIRROR 5 mm', ${sectionId}, 'sqm')`;
    const before = await raw.count('cost_items', owner.orgId);
    expect(await add('MKT-MIRROR', mirror.id)).toEqual({
      ok: false, error: 'check_fields', fields: { nameEn: { code: 'name_taken', params: { code: 'MY-MIRROR' } } },
    });
    expect(await raw.count('cost_items', owner.orgId)).toBe(before);
    expect(await add('MKT-MIRROR', mirror.id, { nameAr: 'مرايا فضية 5 مم', nameEn: 'Silver mirror 5 mm (market)' })).toMatchObject({ ok: true });
  });

  it('reads a name as comparisonForm does in either field, archived own items included, and names each holder (R1, compared in SQL)', async () => {
    const lamp = await seedMarketItem('pcs', { nameAr: 'لمبة إضاءة', nameEn: 'Lamp' });
    await seedBulletin('2096-10', [[lamp.id, '2096-10', '45']]);
    await rebuildSeedBook();
    await marketRaw()`insert into public.cost_items (org_id, code, name_ar, section_id, unit, active)
                      values (${owner.orgId}, 'MY-LAMP-AR', 'لـمـبَة  اضاءه', ${sectionId}, 'pcs', false)`;
    await marketRaw()`insert into public.cost_items (org_id, code, name_ar, name_en, section_id, unit)
                      values (${owner.orgId}, 'MY-LAMP-EN', 'مصباح', 'LAMP', ${sectionId}, 'pcs')`;
    expect(await add('MKT-LAMP', lamp.id)).toEqual({
      ok: false, error: 'check_fields',
      fields: { nameAr: { code: 'name_taken', params: { code: 'MY-LAMP-AR' } }, nameEn: { code: 'name_taken', params: { code: 'MY-LAMP-EN' } } },
    });
    expect(await add('MKT-LAMP', lamp.id, { nameAr: 'لمبة سقف', nameEn: 'مصباح' })).toEqual({
      ok: false, error: 'check_fields', fields: { nameEn: { code: 'name_taken', params: { code: 'MY-LAMP-EN' } } },
    });
    expect(await add('MKT-LAMP', lamp.id, { nameAr: 'لمبة سقف', nameEn: 'Ceiling lamp' })).toMatchObject({ ok: true });
  });

  it('never counts an item linked to the market, or carrying a seed code, as an own item', async () => {
    const twin = await seedMarketItem('sqm', { nameAr: 'زجاج توأم', nameEn: 'Twin glass' });
    await seedBulletin('2096-11', [[twin.id, '2096-11', '50']]);
    await rebuildSeedBook();
    await marketRaw()`insert into public.cost_items (org_id, code, name_en, section_id, unit)
                      values (${owner.orgId}, 'MKT-SOMETHING-ELSE', 'Twin glass', ${sectionId}, 'sqm')`;
    expect(await add('MKT-TWIN', twin.id)).toMatchObject({ ok: true });
  });
});

describe('what no form can send is refused, never thrown (S2, S3)', () => {
  it('refuses a non-object input and a field that is not text as malformed', async () => {
    const base = { marketItemId: glass.id, sectionId };
    expect(await addMarketItemToPriceBookCore(owner, { ...base, code: 123 } as never)).toEqual({ ok: false, error: 'malformed' });
    expect(await addMarketItemToPriceBookCore(owner, { ...base, code: 'OBJ', nameEn: { a: 1 } } as never)).toEqual({ ok: false, error: 'malformed' });
    expect(await addMarketItemToPriceBookCore(owner, null as never)).toEqual({ ok: false, error: 'malformed' });
    expect(await linkCostItemToMarketCore(owner, null as never)).toEqual({ ok: false, error: 'malformed' });
  });

  it('refuses an over-long code and a name with a control character under their fields', async () => {
    const before = await raw.count('cost_items', owner.orgId);
    expect(await add('C'.repeat(200000), rebar.id, { nameAr: `حديد${String.fromCharCode(0)}` })).toEqual({
      ok: false, error: 'check_fields',
      fields: { code: { code: 'too_long', params: { max: COST_ITEM_CODE_MAX } }, nameAr: { code: 'unprintable' } },
    });
    expect(await raw.count('cost_items', owner.orgId)).toBe(before);
  });
});

describe('linkCostItemToMarketCore (AC 13)', () => {
  it('links and unlinks without touching the cost or the price', async () => {
    await marketRaw()`insert into public.cost_items (org_id, code, name_en, section_id, unit, default_unit_cost, default_unit_price)
                      values (${owner.orgId}, 'OWN-GLASS', 'Our glass', ${sectionId}, 'sqm', '420.1234', '512.5000')`;
    const own = await costItem('OWN-GLASS');
    expect(await linkCostItemToMarketCore(owner, { costItemId: own!.id as string, marketItemId: glass.id })).toEqual({ ok: true });
    expect(await costItem('OWN-GLASS')).toEqual({ ...own, market_item_id: glass.id });
    expect(await linkCostItemToMarketCore(owner, { costItemId: own!.id as string, marketItemId: null })).toEqual({ ok: true });
    expect(await costItem('OWN-GLASS')).toEqual(own);
  });

  it('refuses a pcs item against a sqm market item, another studio item, and a reader', async () => {
    await marketRaw()`insert into public.cost_items (org_id, code, name_en, section_id, unit)
                      values (${owner.orgId}, 'OWN-PCS', 'Door', ${sectionId}, 'pcs')`;
    const pcs = await costItem('OWN-PCS');
    expect(await linkCostItemToMarketCore(owner, { costItemId: pcs!.id as string, marketItemId: glass.id })).toEqual({ ok: false, error: 'market_unit_incompatible' });
    expect((await costItem('OWN-PCS'))?.market_item_id).toBeNull();
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
    expect(await linkCostItemToMarketCore(stranger, { costItemId: pcs!.id as string, marketItemId: null })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await linkCostItemToMarketCore(manager, { costItemId: pcs!.id as string, marketItemId: null })).toEqual({ ok: false, error: 'forbidden' });
  });
});
