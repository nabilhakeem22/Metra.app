import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMarketItemToPriceBookCore, linkCostItemToMarketCore } from '@/lib/market-book/core';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw, seedBulletin, seedMarketItem } from './market-fixture';

// "Add to my price book" and the link (plan AC 11 to 13). Periods sit in 2097,
// apart from every other suite's, and every market row is removed afterwards.

const orgIds: string[] = [];
let owner: OrgContext;
let manager: OrgContext;
let sectionId: string;
let glass: { id: string; key: string };
let rebar: { id: string; key: string };
let cement: { id: string; key: string };

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(studio.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  manager = ctxFor(studio.orgId, studio.memberIds[0], 'project_manager');
  sectionId = await raw.sectionId(studio.orgId);
  glass = await seedMarketItem('sqm', { nameAr: 'زجاج شفاف', nameEn: 'Clear glass', specAr: '4 مم', specEn: '4 mm' });
  rebar = await seedMarketItem('ton', { nameEn: 'Rebar' });
  cement = await seedMarketItem('bag', { nameEn: 'Cement' });
  await seedBulletin('2097-05', [[glass.id, '2097-04', '380'], [glass.id, '2097-05', '390'], [rebar.id, '2097-05', '38200'], [cement.id, '2097-05', '90']]);
  // The newer bulletin restates April, prices May anew and suspends rebar in June.
  await seedBulletin('2097-06', [[glass.id, '2097-05', '400'], [glass.id, '2097-06', null], [rebar.id, '2097-06', null]]);
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
const add = (code: string, marketItemId: string, extra: Record<string, string> = {}) =>
  addMarketItemToPriceBookCore(owner, { marketItemId, code, sectionId, ...extra });

describe('addMarketItemToPriceBookCore (AC 11, 12)', () => {
  it('adds a sqm item at its latest effective priced value, linked, named with its spec, and audited', async () => {
    const audits = await raw.count('audit_log', owner.orgId);
    expect(await add('MKT-GLASS', glass.id)).toMatchObject({ ok: true });
    expect(await costItem('MKT-GLASS')).toMatchObject({
      unit: 'sqm', cost: '400.0000', price: '400.0000', market_item_id: glass.id, name_ar: 'زجاج شفاف 4 مم', name_en: 'Clear glass 4 mm',
    });
    expect(await raw.count('audit_log', owner.orgId)).toBe(audits + 1);
  });

  it('adds a ton item as ton, skipping a suspended newest month for the price before it (D3)', async () => {
    expect(await add('MKT-REBAR', rebar.id, { defaultUnitPrice: '40,000', nameEn: 'Steel bars' })).toMatchObject({ ok: true });
    expect(await costItem('MKT-REBAR')).toMatchObject({ unit: 'ton', cost: '38200.0000', price: '40000.0000', name_en: 'Steel bars', name_ar: null });
  });

  it('refuses a bag item, which has no studio unit, and writes nothing', async () => {
    const before = await raw.count('cost_items', owner.orgId);
    expect(await add('MKT-CEMENT', cement.id)).toEqual({ ok: false, error: 'market_unit_incompatible' });
    expect(await raw.count('cost_items', owner.orgId)).toBe(before);
  });

  it('says a taken code under the code field, and a bad price under the price field', async () => {
    expect(await add('MKT-GLASS', glass.id)).toEqual({ ok: false, error: 'check_fields', fields: { code: { code: 'code_taken' } } });
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
