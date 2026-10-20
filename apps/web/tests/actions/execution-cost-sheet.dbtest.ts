import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { getProjectEffectiveRates } from '@/lib/clients/financials';
import { getProjectCostSummary } from '@/lib/execution/cost-sheet/project';
import { loadCostSheetCore } from '@/lib/execution/cost-sheet/read-core';
import { getProjectOverview } from '@/lib/projects/queries';
import { seedPayment } from './execution-billing-fixture';
import { seedOrderWithLines } from './execution-final-account-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedRequest } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A5.3: the cost sheet (كشف التكلفة) from SQL aggregates. AC30 (totals
// equal the rows to the piastre: 3 sections, cost booked to no section, one
// approved change order on a line and on new scope, a void entry left out),
// the per-section projected margin (owner decision Oct 19), the sections past
// the cap folded by the same rule, and AC31 (margin hidden from a PM when the
// studio hides it; the site engineer cannot open the sheet). The A5 fix round:
// a new-scope de-scope counts as it is (F2), cost booked to no section is never
// over budget (F5), a PM who may not see margin gets billing only on the sheet
// and on the project's Financials (F10, S1), and the project's contracted
// value counts its execution contract (F4).

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer'];

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: ROLES.map((role) => ({ role })) });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  ctx.owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  ROLES.forEach((role, index) => (ctx[role] = ctxFor(orgId, seeded.memberIds[index], role)));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

async function cost(contractId: string, sectionId: string | null, amount: string, voided = false): Promise<void> {
  await ownerQuery(
    `insert into public.contract_cost_entries
       (org_id, contract_id, contract_section_id, category, description, amount, incurred_on, recorded_by, voided_at, voided_by)
     values ($1, $2, $3, 'materials', 'Cost', $4, current_date, $5,
             case when $6::boolean then now() end, case when $6::boolean then $5::uuid end)`,
    [orgId, contractId, sectionId, amount, ctx.owner!.userId, voided],
  );
}

async function sheet(contractId: string, member = ctx.owner!) {
  const res = await loadCostSheetCore(member, { contractId });
  if (!res.ok || !res.data) throw new Error(`read failed: ${JSON.stringify(res)}`);
  return res.data;
}

/** The cost side, for a reader who may see it. */
async function costOf(contractId: string, member = ctx.owner!) {
  const { cost } = await sheet(contractId, member);
  if (!cost) throw new Error('the cost was left out');
  return cost;
}

/** Every key, at any depth, whose value is not null. */
function keysWithValues(value: unknown, into: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return into;
  for (const [key, inner] of Object.entries(value)) {
    if (inner !== null) into.push(key);
    keysWithValues(inner, into);
  }
  return into;
}

async function hidingMarginFromPms<T>(run: () => Promise<T>): Promise<T> {
  await ownerQuery(`update public.organizations set hide_margin_from_pm = true where id = $1`, [orgId]);
  try {
    return await run();
  } finally {
    await ownerQuery(`update public.organizations set hide_margin_from_pm = false where id = $1`, [orgId]);
  }
}

describe('getCostSheet', () => {
  it('AC30: totals equal the sums of the underlying rows to the piastre, projected per section', async () => {
    // Line n costs n x 60: sections of 2, 3 and 4 lines budget 180, 360 and 600.
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [2, 3, 4] });
    const [s1, s2, s3] = contract.sectionIds;
    // +2 on a line of section 2 (cost 120, takes its section) and 5 of new scope (cost 300): net 700.
    await seedOrderWithLines(orgId, contract, [{ contractLineId: contract.lineIds[1][0], qty: '2' }, { contractLineId: null, qty: '5' }]);
    await cost(contract.contractId, s1, '100.0001');
    await cost(contract.contractId, s1, '99.9999');
    await cost(contract.contractId, s2, '300');
    await cost(contract.contractId, s3, '999', true);
    await cost(contract.contractId, null, '50');
    const request = await seedRequest(orgId, contract.contractId, ctx.owner!.userId);
    await seedPayment(orgId, contract.contractId, request, ctx.owner!.userId, '200');

    const { billing, cost: costSide } = await sheet(contract.contractId);
    expect(costSide?.sections.map((row) => [row.kind, row.sectionId, row.budgetCost, row.actualCost, row.overBudget])).toEqual([
      ['section', s1, '180.0000', '200.0000', true],
      ['section', s2, '480.0000', '300.0000', false],
      ['section', s3, '600.0000', '0.0000', false],
      // F5: no budget, so never over one.
      ['whole_contract', null, null, '50.0000', false],
      ['change_orders', null, '300.0000', null, false],
    ]);
    expect(costSide?.totals).toEqual({ budgetCost: '1560.0000', actualCost: '550.0000' });
    // 124,000 + 700 works + 98 VAT + 70 supervision ; ex VAT 124,000 - 14,000 + 770
    expect(costSide?.value).toEqual({ originalValue: '124000.0000', approvedVariations: '868.0000', revisedValue: '124868.0000', valueExVat: '110770.0000' });
    expect(billing).toEqual({ requested: '500.0000', paid: '200.0000', outstanding: '300.0000' });
    // planned 110,770 - 1,560 ; projected 110,770 - (200 + 480 + 600 + 300 + 50)
    expect(costSide?.margin).toMatchObject({ planned: '109210.0000', projected: '109140.0000' });
  });

  it('folds the sections past 200 into one row, each still counted by its own max', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: Array<number>(203).fill(1) });
    await cost(contract.contractId, contract.sectionIds[201], '100');
    const result = await costOf(contract.contractId);
    expect(result.sections.filter((row) => row.kind === 'section')).toHaveLength(200);
    expect(result.sections[200]).toMatchObject({ kind: 'more_sections', count: 3, budgetCost: '180.0000', actualCost: '100.0000' });
    expect(result.totals).toEqual({ budgetCost: '12180.0000', actualCost: '100.0000' });
    // 110,000 ex VAT - (200 x 60 + 60 + 100 + 60)
    expect(result.margin.projected).toBe('97780.0000');
  });

  it('F2: a new-scope de-scope counts as it is, so with nothing spent projected equals planned (the D7 repro)', async () => {
    // One line of cost 60 ; an approved order of qty -1 at price 100 and cost 60, on no contract line.
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    await seedOrderWithLines(orgId, contract, [{ contractLineId: null, qty: '-1' }]);
    const { margin, sections } = await costOf(contract.contractId);
    // ex VAT 110,000 - 100 works - 10 supervision ; budget 60 - 60
    expect(margin).toMatchObject({ planned: '109890.0000', projected: '109890.0000' });
    expect(sections.at(-1)).toMatchObject({ kind: 'change_orders', budgetCost: '-60.0000', overBudget: false });
  });

  it('AC31, F10, S1: a PM in a studio that hides margin gets billing only; the site engineer and the viewer cannot open it', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    await cost(contract.contractId, contract.sectionIds[0], '40');
    expect((await sheet(contract.contractId, ctx.project_manager!)).cost).not.toBeNull();
    await hidingMarginFromPms(async () => {
      const hidden = await sheet(contract.contractId, ctx.project_manager!);
      expect(hidden).toEqual({ billing: { requested: '0.0000', paid: '0.0000', outstanding: '0.0000' }, cost: null });
      // Nothing to subtract a margin from: no value, budget, cost, variance or margin with a value, at any depth.
      expect(keysWithValues(hidden).filter((key) => /value|budget|cost|actual|variance|margin|section|total/i.test(key))).toEqual([]);
      expect((await sheet(contract.contractId, ctx.accountant!)).cost?.margin).not.toBeNull();
    });
    for (const role of ['site_engineer', 'viewer'] as const) {
      expect(await loadCostSheetCore(ctx[role]!, { contractId: contract.contractId })).toEqual({ ok: false, error: 'forbidden' });
    }
  });

  it('F10, S1: the project Financials give that PM the execution contract\'s billing only', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    await cost(contract.contractId, contract.sectionIds[0], '40');
    const request = await seedRequest(orgId, contract.contractId, ctx.owner!.userId);
    await seedPayment(orgId, contract.contractId, request, ctx.owner!.userId, '200');
    const owners = await getProjectCostSummary(ctx.owner!, contract.projectId, true);
    expect(owners?.cost).toMatchObject({ budgetCost: '360.0000', actualCost: '40.0000' });
    const hidden = await getProjectCostSummary(ctx.project_manager!, contract.projectId, false);
    expect(hidden).toEqual({
      contractId: contract.contractId,
      billing: { requested: '500.0000', paid: '200.0000', outstanding: '300.0000' },
      cost: null,
    });
    expect(keysWithValues(hidden).filter((key) => /value|budget|cost|actual|variance|margin/i.test(key))).toEqual([]);
  });

  it('F4: the project\'s contracted value counts its execution contract, and its rates leave it out', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    expect((await getProjectOverview(ctx.owner!, contract.projectId)).contractedTotal).toBe('124000.0000');
    expect(await getProjectEffectiveRates(ctx.owner!, contract.projectId)).toEqual({
      advancePct: null,
      retentionPct: null,
      contractCount: 0,
      executionContractCount: 1,
    });
    const draft = await seedExecutionContract(orgId, { state: 'draft' });
    expect((await getProjectOverview(ctx.owner!, draft.projectId)).contractedTotal).toBe('0.0000');
    expect((await getProjectEffectiveRates(ctx.owner!, draft.projectId)).executionContractCount).toBe(0);
  });

  it('answers record_not_found for a proposal contract or another org\'s, and malformed for a bad id', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const outsider = await seedOrg({ owners: 1 });
    orgIds.push(outsider.orgId);
    expect(await loadCostSheetCore(ctxFor(outsider.orgId, outsider.ownerIds[0], 'owner'), { contractId: contract.contractId })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await loadCostSheetCore(ctx.owner!, { contractId: 'nope' })).toEqual({ ok: false, error: 'malformed' });
  });
});
