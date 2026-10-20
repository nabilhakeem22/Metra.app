import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { issueFinalAccountCore } from '@/lib/execution/final-account/issue';
import { loadFinalAccountCore, loadFinalAccountDifferencesCore } from '@/lib/execution/final-account/read-core';
import { recordMeasurementCore } from '@/lib/execution/measurements/core';
import { issueMilestoneRequestCore } from '@/lib/execution/requests/issue-milestone';
import { issueVariationRequestCore } from '@/lib/execution/requests/issue-variation';
import { voidPaymentRequestCore } from '@/lib/execution/requests/void';
import { internalApproveVariationCore } from '@/lib/variations/lifecycle/internal-approve';
import { requestRow, seedBillableContract } from './execution-billing-fixture';
import { seedOrderWithLines, seedReading } from './execution-final-account-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedRequest, seedVariation, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A5.2: the final account (الحساب الختامي). AC26 (D2a: provisional lines
// bill their measured difference, firm ones are flagged), AC27 (the three
// refusals), AC28 (it closes requests, measurements and approvals; a void of
// the unpaid final account reopens them), AC29 (one per contract under a
// race), and the lock order: a final account racing a measurement or an
// approval never deadlocks and never bills past what it was shown.

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'accountant', 'viewer'];

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

async function account(contractId: string) {
  const res = await loadFinalAccountCore(ctx.owner!, { contractId });
  if (!res.ok || !res.data) throw new Error(`read failed: ${JSON.stringify(res)}`);
  return res.data;
}

const issue = (contractId: string, expectedAmount: string, member = ctx.owner!) =>
  issueFinalAccountCore(member, { contractId, expectedAmount });

/** AC26's contract: line 5 provisional (200 at 100) read 240; line 3 firm (8) read 12 with +4 ordered; line 4 firm (8) read 10. */
async function ac26Contract() {
  const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [5] });
  const [, , line3, line4, line5] = contract.lineIds[0];
  await tamper(`update public.contract_lines set qty = 200 where id = $1`, [line5]);
  await tamper(`update public.contract_lines set qty = 8 where id = any($1::uuid[])`, [[line3, line4]]);
  await seedOrderWithLines(orgId, contract, [{ contractLineId: line3, qty: '4' }]);
  for (const [line, qty] of [[line5, '240'], [line3, '12'], [line4, '10']] as const) await seedReading(orgId, contract.contractId, line, qty, ctx.owner!.userId);
  return { ...contract, line3, line4, line5 };
}

describe('the final account card', () => {
  it('AC26: the provisional line bills 4,000 works, the covered firm line adds nothing, the uncovered one is flagged', async () => {
    const contract = await ac26Contract();
    const view = await account(contract.contractId);
    expect(view.figures).toEqual({
      // the change order of +4 at 100: 400 + 56 VAT + 40 supervision
      variationsCharge: '496.0000',
      adjustmentWorks: '4000.0000',
      adjustmentCharge: '4960.0000',
      finalValue: '129456.0000',
      billedSoFar: '0.0000',
      balance: '129456.0000',
    });
    expect(view.counts).toEqual({ billed: 1, flagged: 1 });
    expect(view.differences.rows.map((row) => [row.lineId, row.residualQty, row.works, row.provisional])).toEqual([
      [contract.line4, '2.0000', null, false],
      [contract.line5, '40.0000', '4000.0000', true],
    ]);
    expect(view.differences.nextCursor).toBeNull();
    expect(view.issued).toBeNull();
  });

  it('pages the differences 50 at a time in document order, and counts each kind', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [60] });
    await ownerQuery(
      `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       select $1, $2, l.id, 999, current_date, $3 from public.contract_lines l where l.contract_id = $2`,
      [orgId, contract.contractId, ctx.owner!.userId],
    );
    const view = await account(contract.contractId);
    expect(view.counts).toEqual({ billed: 12, flagged: 48 });
    expect(view.differences.rows.map((row) => row.lineId)).toEqual(contract.lineIds[0].slice(0, 50));
    const more = await loadFinalAccountDifferencesCore(ctx.owner!, { contractId: contract.contractId, afterLineId: view.differences.nextCursor });
    expect(more.data?.rows.map((row) => row.lineId)).toEqual(contract.lineIds[0].slice(50));
    expect(more.data?.nextCursor).toBeNull();
    // line 60 (provisional): (999 - 60) x 100
    expect(more.data?.rows[9]).toMatchObject({ provisional: true, residualQty: '939.0000', works: '93900.0000' });
    expect(Object.keys(view.differences.rows[0])).not.toContain('unitPrice');
  });
});

describe('issueFinalAccountCore', () => {
  it('issues the balance it was shown as the last request, with the VAT not yet billed', async () => {
    const contract = await ac26Contract();
    const res = await issue(contract.contractId, '129456');
    expect(res).toMatchObject({ ok: true });
    // 14,000 + 56 + 560 VAT, nothing billed before
    expect(await requestRow(res.data!)).toMatchObject({ kind: 'final_account', status: 'issued', amount: '129456.0000', tax_amount: '14616.0000' });
    const view = await account(contract.contractId);
    expect(view.issued).toMatchObject({ id: res.data, amount: '129456.0000', paid: '0.0000', outstanding: '129456.0000' });
    expect(view.figures.balance).toBe('129456.0000');
  });

  it('AC27: refuses an open change order, nothing due, and a balance that moved', async () => {
    const open = await seedBillableContract(orgId);
    await seedVariation(orgId, open, 'issued');
    expect(await issue(open.contractId, '1')).toEqual({ ok: false, error: 'open_variations' });

    const billed = await seedBillableContract(orgId);
    await seedRequest(orgId, billed.contractId, ctx.owner!.userId, { milestoneId: billed.milestoneIds[0] }, '124000');
    expect(await issue(billed.contractId, '0')).toEqual({ ok: false, error: 'final_account_nothing_due' });

    const moved = await ac26Contract();
    expect(await issue(moved.contractId, '129455.9999')).toEqual({ ok: false, error: 'final_account_changed', params: { amount: '129456.0000' } });
  });

  it('refuses a role without invoices_issue, an unsigned contract, and a malformed payload', async () => {
    const contract = await seedBillableContract(orgId);
    for (const role of ['project_manager', 'viewer'] as const) expect(await issue(contract.contractId, '124000', ctx[role]!)).toEqual({ ok: false, error: 'forbidden' });
    const unsigned = await seedBillableContract(orgId, 'issued');
    expect(await issue(unsigned.contractId, '124000')).toEqual({ ok: false, error: 'contract_not_signed' });
    for (const input of [null, { contractId: contract.contractId }, { contractId: 'x', expectedAmount: '1' }, { contractId: contract.contractId, expectedAmount: '1,5' }]) {
      expect(await issueFinalAccountCore(ctx.owner!, input as never)).toEqual({ ok: false, error: 'malformed' });
    }
    expect(await issueFinalAccountCore(ctx.owner!, { contractId: contract.contractId, expectedAmount: '124000', dueOn: '2001-01-01' })).toMatchObject({
      ok: false, error: 'check_fields', fields: { dueOn: { code: 'date_in_past' } },
    });
    expect(await issue(contract.contractId, '124000', ctx.accountant!)).toMatchObject({ ok: true });
  });

  it('AC28: once issued it closes requests, measurements and approvals; a void of the unpaid final account reopens them', async () => {
    const contract = await seedBillableContract(orgId);
    const order = await seedOrderWithLines(orgId, contract, [{ contractLineId: null, qty: '10' }]);
    const draft = await seedVariation(orgId, contract, 'draft');
    const finalAccount = await issue(contract.contractId, '125240');
    expect(finalAccount).toMatchObject({ ok: true });
    const measure = () =>
      recordMeasurementCore(ctx.owner!, { contractId: contract.contractId, contractLineId: contract.lineIds[0][0], measuredQty: '1', measuredOn: todayInCairo(new Date()), idempotencyKey: randomUUID() });
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] })).toEqual({ ok: false, error: 'final_account_issued' });
    expect(await issueVariationRequestCore(ctx.owner!, { variationOrderId: order })).toEqual({ ok: false, error: 'final_account_issued' });
    expect(await measure()).toEqual({ ok: false, error: 'final_account_issued' });
    expect(await internalApproveVariationCore(ctx.owner!, { id: draft.id })).toEqual({ ok: false, error: 'final_account_issued' });

    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: finalAccount.data, reason: 'Wrong count' })).toEqual({ ok: true });
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] })).toMatchObject({ ok: true });
    expect(await issueVariationRequestCore(ctx.owner!, { variationOrderId: order })).toMatchObject({ ok: true });
    expect(await measure()).toMatchObject({ ok: true });
    expect(await internalApproveVariationCore(ctx.owner!, { id: draft.id })).toMatchObject({ ok: true });
  });

  it('AC29: concurrent issues create one final account; the losers are request_exists', async () => {
    const contract = await seedBillableContract(orgId);
    const results = await Promise.all([ctx.owner!, ctx.admin!, ctx.accountant!].map((member) => issue(contract.contractId, '124000', member)));
    expect(results.filter((res) => res.ok)).toHaveLength(1);
    expect(results.filter((res) => !res.ok).map((res) => res.error)).toEqual(['request_exists', 'request_exists']);
    const [count] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.payment_requests where contract_id = $1`, [contract.contractId]);
    expect(count.n).toBe(1);
  });

  it('a final account racing a measurement or an approval: one of them wins, never both, never a deadlock', async () => {
    for (let round = 0; round < 6; round++) {
      // Line 5 is provisional: a reading on it moves the balance the final account was shown.
      const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [5] });
      const provisional = contract.lineIds[0][4];
      const draft = await seedVariation(orgId, contract, 'draft');
      const [finalAccount, measured, approved] = await Promise.all([
        issue(contract.contractId, '124000'),
        recordMeasurementCore(ctx.admin!, { contractId: contract.contractId, contractLineId: provisional, measuredQty: '900', measuredOn: todayInCairo(new Date()), idempotencyKey: randomUUID() }),
        internalApproveVariationCore(ctx.admin!, { id: draft.id }),
      ]);
      const outcomes = [finalAccount, measured, approved].map((res) => (res.ok ? 'ok' : (res.error ?? 'none')));
      expect(outcomes.every((outcome) => ['ok', 'final_account_issued', 'final_account_changed', 'open_variations'].includes(outcome)), outcomes.join()).toBe(true);
      if (finalAccount.ok) expect([measured.ok, approved.ok]).toEqual([false, false]);
      else expect(measured.ok || approved.ok).toBe(true);
    }
  });
});
