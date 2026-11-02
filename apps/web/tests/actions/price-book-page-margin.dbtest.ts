import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { FIRST_VIEW } from '@/lib/price-book/page-params';
import { loadPriceBookPage } from '@/lib/price-book/page-data';
import type { MemberRole } from '@/lib/permissions/roles';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw, seedBulletin, seedMarketItem } from './market-fixture';

// Go-live security fix round, T1: the price book PAGE hides the unit cost from a
// reader who may not see margin, by the same resolveSeeMargin rule as the BOQ
// template. loadPriceBookPage answers the props the page hands PriceBookClient,
// which is exactly what React serializes into the RSC payload and renders into
// the HTML: a cost absent from them is absent from both. The Market column's
// variance is hidden too, because beside the public market price it gives the
// cost away. Market periods sit in 2093, apart from every other suite's.

const COST = '777.4321';
const LINKED_COST = '420.1234';
const PRICE = '999.0000';
const MEMBERS: readonly MemberRole[] = ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer', 'client'];

const orgIds: string[] = [];
const hidden: Record<string, OrgContext> = {};
const shown: Record<string, OrgContext> = {};

async function seedStudio(hideMarginFromPm: boolean, marketItemId: string): Promise<Record<string, OrgContext>> {
  const org = await seedOrg({ owners: 1, members: MEMBERS.map((role) => ({ role })) });
  orgIds.push(org.orgId);
  await raw.query(`update public.organizations set hide_margin_from_pm = ${hideMarginFromPm} where id = '${org.orgId}'`);
  const sectionId = await raw.sectionId(org.orgId);
  await marketRaw()`
    insert into public.cost_items (org_id, section_id, code, name_en, unit, default_unit_cost, default_unit_price, market_item_id)
    values (${org.orgId}, ${sectionId}, 'T1-OWN', 'Own item', 'sqm', ${COST}, ${PRICE}, null),
           (${org.orgId}, ${sectionId}, 'T1-TILE', 'Tile', 'sqm', ${LINKED_COST}, ${PRICE}, ${marketItemId})`;
  const ctx: Record<string, OrgContext> = { owner: ctxFor(org.orgId, org.ownerIds[0], 'owner') };
  MEMBERS.forEach((role, n) => {
    ctx[role] = ctxFor(org.orgId, org.memberIds[n], role);
  });
  return ctx;
}

beforeAll(async () => {
  const tile = await seedMarketItem('sqm', { nameEn: 'Porcelain tile T1' });
  await seedBulletin('2093-06', [[tile.id, '2093-06', '400']]);
  Object.assign(hidden, await seedStudio(true, tile.id));
  Object.assign(shown, await seedStudio(false, tile.id));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

const propsOf = (ctx: OrgContext) => loadPriceBookPage(ctx, FIRST_VIEW, 'en');

describe('the price book page props, per role (T1)', () => {
  it('a project manager while the studio hides margin gets no unit cost and no variance, only the prices', async () => {
    const props = await propsOf(hidden.project_manager);
    expect(props).not.toBeNull();
    const payload = JSON.stringify(props);
    for (const cost of [COST, LINKED_COST, '777.43', '420.12']) expect(payload).not.toContain(cost);
    expect(payload).toContain(PRICE);
    expect(props?.showsCost).toBe(false);
    expect(props?.book.rows.map((row) => row.defaultUnitCost)).toEqual([null, null]);
    const [reference] = Object.values(props?.market.refs ?? {});
    expect(reference).toMatchObject({ price: '400.0000', month: '2093-06', variancePct: null, reason: 'ok' });
  });

  it.each<[string, Record<string, OrgContext>, MemberRole]>([
    ['owner, hiding studio', hidden, 'owner'],
    ['admin, hiding studio', hidden, 'admin'],
    ['accountant, hiding studio', hidden, 'accountant'],
    ['project manager, studio that shows margin', shown, 'project_manager'],
  ])('%s: sees every unit cost and the variance', async (_label, studio, role) => {
    const props = await propsOf(studio[role]);
    const payload = JSON.stringify(props);
    expect(payload).toContain(COST);
    expect(payload).toContain(LINKED_COST);
    expect(props?.showsCost).toBe(true);
    expect(Object.values(props?.market.refs ?? {})[0]).toMatchObject({ variancePct: '5.0', reason: 'ok' });
  });

  it.each<MemberRole>(['site_engineer', 'viewer', 'client'])('%s cannot read the price book at all (the page 404s)', async (role) => {
    expect(await propsOf(hidden[role])).toBeNull();
    expect(await propsOf(shown[role])).toBeNull();
  });
});
