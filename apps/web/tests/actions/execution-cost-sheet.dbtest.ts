import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { loadCostSheetCore } from '@/lib/execution/cost-sheet/read-core';
import { seedPayment } from './execution-billing-fixture';
import { seedOrderWithLines } from './execution-final-account-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedRequest } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A5.3: the cost sheet (كشف التكلفة) from SQL aggregates. AC30 (totals
// equal the rows to the piastre: 3 sections, cost booked to no section, one
// approved change order on a line and on new scope, a void entry left out),
// the per-section projected margin (owner decision Oct 19), the sections past
// the cap folded by the same rule, and AC31 (margin hidden from a PM when the
// studio hides it; the site engineer cannot open the sheet).

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

    const result = await sheet(contract.contractId);
    expect(result.sections.map((row) => [row.kind, row.sectionId, row.budgetCost, row.actualCost, row.overBudget])).toEqual([
      ['section', s1, '180.0000', '200.0000', true],
      ['section', s2, '480.0000', '300.0000', false],
      ['section', s3, '600.0000', '0.0000', false],
      ['whole_contract', null, '0.0000', '50.0000', true],
      ['change_orders', null, '300.0000', null, false],
    ]);
    expect(result.totals).toEqual({ budgetCost: '1560.0000', actualCost: '550.0000' });
    // 124,000 + 700 works + 98 VAT + 70 supervision ; ex VAT 124,000 - 14,000 + 770
    expect(result.value).toEqual({ originalValue: '124000.0000', approvedVariations: '868.0000', revisedValue: '124868.0000', valueExVat: '110770.0000' });
    expect(result.billing).toEqual({ requested: '500.0000', paid: '200.0000', outstanding: '300.0000' });
    // planned 110,770 - 1,560 ; projected 110,770 - (200 + 480 + 600 + 300 + 50)
    expect(result.margin).toMatchObject({ planned: '109210.0000', projected: '109140.0000' });
  });

  it('folds the sections past 200 into one row, each still counted by its own max', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: Array<number>(203).fill(1) });
    await cost(contract.contractId, contract.sectionIds[201], '100');
    const result = await sheet(contract.contractId);
    expect(result.sections.filter((row) => row.kind === 'section')).toHaveLength(200);
    expect(result.sections[200]).toMatchObject({ kind: 'more_sections', count: 3, budgetCost: '180.0000', actualCost: '100.0000' });
    expect(result.totals).toEqual({ budgetCost: '12180.0000', actualCost: '100.0000' });
    // 110,000 ex VAT - (200 x 60 + 60 + 100 + 60)
    expect(result.margin?.projected).toBe('97780.0000');
  });

  it('AC31: a PM in a studio that hides margin gets no margin; the site engineer and the viewer cannot open it', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    expect((await sheet(contract.contractId, ctx.project_manager!)).margin).not.toBeNull();
    await ownerQuery(`update public.organizations set hide_margin_from_pm = true where id = $1`, [orgId]);
    try {
      const hidden = await sheet(contract.contractId, ctx.project_manager!);
      expect(hidden.margin).toBeNull();
      expect(hidden.totals.budgetCost).toBe('360.0000');
      expect((await sheet(contract.contractId, ctx.accountant!)).margin).not.toBeNull();
    } finally {
      await ownerQuery(`update public.organizations set hide_margin_from_pm = false where id = $1`, [orgId]);
    }
    for (const role of ['site_engineer', 'viewer'] as const) {
      expect(await loadCostSheetCore(ctx[role]!, { contractId: contract.contractId })).toEqual({ ok: false, error: 'forbidden' });
    }
  });

  it('answers record_not_found for a proposal contract or another org\'s, and malformed for a bad id', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const outsider = await seedOrg({ owners: 1 });
    orgIds.push(outsider.orgId);
    expect(await loadCostSheetCore(ctxFor(outsider.orgId, outsider.ownerIds[0], 'owner'), { contractId: contract.contractId })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await loadCostSheetCore(ctx.owner!, { contractId: 'nope' })).toEqual({ ok: false, error: 'malformed' });
  });
});
