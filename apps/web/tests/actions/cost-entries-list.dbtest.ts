import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createCostEntryCore, voidCostEntryCore } from '@/lib/execution/costs/core';
import { loadCostEntriesCore } from '@/lib/execution/costs/reads';
import { NO_COST_FILTER, type CostEntriesCursor, type CostEntryRow } from '@/lib/execution/costs/types';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, type ExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { closeMarketFixture, seedBulletin, seedMarketItem } from './market-fixture';
import { rebuildSeedBook } from './market-seed-fixture';

// Stage 2 PR B3.1: the Costs tab's list (AC22: 50 a page, keyset on incurred_on
// desc then id desc, voided entries in no total) and the market reference
// joined in the same read (AC23: shown for a compatible unit only). Market
// periods sit in 2095, apart from every other suite's.

const orgIds: string[] = [];
let owner: OrgContext;
let viewer: OrgContext;
let stranger: OrgContext;
let contract: ExecutionContract;
let quiet: ExecutionContract;
let linkedItemId: string;
let unlinkedItemId: string;

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'viewer' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId, other.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  viewer = ctxFor(studio.orgId, studio.memberIds[0], 'viewer');
  stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
  contract = await seedExecutionContract(studio.orgId, { state: 'signed', linesPerSection: [2, 2] });
  quiet = await seedExecutionContract(studio.orgId, { state: 'issued' });
  // 120 entries over 40 days, three a day, so the keyset crosses days and ties.
  await ownerQuery(
    `insert into public.contract_cost_entries (org_id, contract_id, contract_section_id, category, description, amount, incurred_on, recorded_by)
     select $1, $2, case when n % 2 = 0 then $3::uuid end, case when n % 3 = 0 then 'labour' else 'materials' end::cost_category,
            'Entry ' || n, n, date '2026-09-30' - (n / 3), $4
       from generate_series(1, 120) as n`,
    [studio.orgId, contract.contractId, contract.sectionIds[0], owner.userId],
  );
  const glass = await seedMarketItem('sqm', { nameEn: 'Costs tab glass' });
  await seedBulletin('2095-06', [[glass.id, '2095-06', '400']]);
  await rebuildSeedBook();
  const sectionId = await raw.sectionId(studio.orgId);
  [{ id: linkedItemId }, { id: unlinkedItemId }] = await ownerQuery<{ id: string }>(
    `insert into public.cost_items (org_id, section_id, code, name_en, unit, default_unit_cost, default_unit_price, market_item_id)
     values ($1, $2, 'B3-GLASS', 'Glass', 'sqm', 400, 420, $3), ($1, $2, 'B3-OWN', 'Own glass', 'sqm', 400, 420, null)
     returning id`,
    [studio.orgId, sectionId, glass.id],
  );
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeMarketFixture();
  await closeFixture();
});

const load = (cursor: CostEntriesCursor | null, filter = NO_COST_FILTER, ctx = owner, contractId = contract.contractId) =>
  loadCostEntriesCore(ctx, { contractId, filter, cursor });

describe('loadCostEntriesCore (AC22)', () => {
  it('pages 50 at a time in (incurred_on desc, id desc) order, every entry once', async () => {
    const seen: CostEntryRow[] = [];
    let cursor: CostEntriesCursor | null = null;
    const sizes: number[] = [];
    do {
      const page = await load(cursor);
      if (!page.ok || !page.data) throw new Error(JSON.stringify(page));
      sizes.push(page.data.entries.length);
      seen.push(...page.data.entries);
      cursor = page.data.next;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    const expected = await ownerQuery<{ id: string }>(
      `select id from public.contract_cost_entries where contract_id = $1 order by incurred_on desc, id desc`,
      [contract.contractId],
    );
    expect(seen.map((entry) => entry.id)).toEqual(expected.map((row) => row.id));
  });

  it('totals the live entries of the filter on the first page only, a voided one left out', async () => {
    const first = await load(null, { category: 'labour', sectionId: null });
    expect(first.data?.totals).toEqual({ count: 40, amount: '2460.0000' });
    const voided = first.data?.entries[0] as CostEntryRow;
    expect(await voidCostEntryCore(owner, { id: voided.id })).toEqual({ ok: true });
    const after = await load(null, { category: 'labour', sectionId: null });
    expect(after.data?.totals).toEqual({ count: 39, amount: (2460 - Number(voided.amount)).toFixed(4) });
    expect(after.data?.entries.find((entry) => entry.id === voided.id)?.voided).toBe(true);
    const unfiltered = await load(null);
    expect((await load(unfiltered.data?.next as CostEntriesCursor)).data?.totals).toBeNull();
  });

  it('narrows to a section', async () => {
    const page = await load(null, { category: null, sectionId: contract.sectionIds[0] });
    expect(page.data?.entries.every((entry) => entry.contractSectionId === contract.sectionIds[0])).toBe(true);
    expect(page.data?.entries[0]).toMatchObject({ sectionTitleEn: 'Section 1' });
  });

  it('refuses a viewer, another studio, and a forged cursor or filter', async () => {
    expect(await load(null, NO_COST_FILTER, viewer)).toEqual({ ok: false, error: 'forbidden' });
    expect(await load(null, NO_COST_FILTER, stranger)).toEqual({ ok: false, error: 'record_not_found' });
    expect(await load({ incurredOn: '2026-02-30', id: randomUUID() })).toEqual({ ok: false, error: 'malformed' });
    expect(await loadCostEntriesCore(owner, { contractId: contract.contractId, filter: { category: 'x', sectionId: null }, cursor: null })).toEqual({
      ok: false, error: 'malformed',
    });
  });
});

describe('the market reference (AC23)', () => {
  const record = (fields: Record<string, unknown>) =>
    createCostEntryCore(owner, {
      contractId: quiet.contractId, idempotencyKey: randomUUID(), category: 'materials', description: 'Glass', amount: '840', incurredOn: '2026-10-01', ...fields,
    });

  it('shows the market unit cost and the variance for a compatible unit, and nothing otherwise', async () => {
    await record({ costItemId: linkedItemId, qty: '2', unit: 'sqm', unitCost: '420' });
    await record({ costItemId: linkedItemId, qty: '2', unit: 'pcs', unitCost: '420' });
    await record({ costItemId: unlinkedItemId, qty: '2', unit: 'sqm', unitCost: '420' });
    await record({ costItemId: linkedItemId });
    const page = await load(null, NO_COST_FILTER, owner, quiet.contractId);
    const byUnit = page.data?.entries.map((entry) => [entry.costItemCode, entry.unit, entry.market]);
    expect(byUnit).toEqual(
      expect.arrayContaining([
        ['B3-GLASS', 'sqm', { unitCost: '400.0000', variancePct: '5.0' }],
        ['B3-GLASS', 'pcs', null],
        ['B3-OWN', 'sqm', null],
        ['B3-GLASS', null, null],
      ]),
    );
    expect(byUnit).toHaveLength(4);
  });
});
