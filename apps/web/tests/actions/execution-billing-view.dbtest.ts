import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { withBillingView } from '@/lib/execution/billing/after-write';
import { loadContractBillingCore, loadContractPaymentsCore } from '@/lib/execution/billing/read-core';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { recordContractPaymentCore } from '@/lib/execution/payments/core';
import { issueMilestoneRequestCore } from '@/lib/execution/requests/issue-milestone';
import { voidPaymentRequestCore } from '@/lib/execution/requests/void';
import { todayInCairo } from '@/lib/automation/clock';
import { seedBillableContract, seedPendingClaim } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedVariation } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A4.3: what the contract's Payments tab reads. Bounded: requests with what
// is paid and due on each, the change orders still to bill, and the ledger 50
// rows a page by keyset (received_on desc, id desc).

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['project_manager', 'site_engineer', 'accountant', 'viewer', 'client'];
const TODAY = todayInCairo(new Date());

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

async function billingOf(contractId: string, member = ctx.owner!): Promise<ContractBillingView> {
  const res = await loadContractBillingCore(member, { contractId });
  expect(res.ok).toBe(true);
  return res.data!;
}

describe('the Payments tab view', () => {
  it('says each row billed or not, each request paid and due, the claim, and what is left to bill', async () => {
    const contract = await seedBillableContract(orgId);
    const sent = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] });
    const voided = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[1] });
    await voidPaymentRequestCore(ctx.owner!, { requestId: voided.data!, reason: 'Wrong amount' });
    await recordContractPaymentCore(ctx.owner!, { requestId: sent.data!, amount: '2000', receivedOn: TODAY, idempotencyKey: crypto.randomUUID() });
    await seedPendingClaim(orgId, contract.contractId, sent.data!);
    const order = await seedVariation(orgId, contract, 'approved', { netDelta: '10000' });
    await seedVariation(orgId, contract, 'approved', { netDelta: '-100' });

    // 124,000 + 12,400 (the +10,000 order) - 124 (the -100 de-scope) - 62,000 issued.
    const view = await billingOf(contract.contractId, ctx.viewer!);
    expect(view).toMatchObject({ status: 'signed', finalAccountIssued: false, billingBalance: '74276.0000', moreRequests: false });
    // No issued event in the fixture: the contract's own day, in Cairo (contractIssuedOnInCairo).
    expect(view.issuedOn).toBe(TODAY);
    expect(view.schedule.map((row) => [row.labelEn, row.amount, row.billed])).toEqual([
      ['Advance', '62000.0000', true],
      ['Works', '37200.0000', false],
      ['Handover', '24800.0000', false],
    ]);
    expect(view.variations).toEqual([expect.objectContaining({ id: order.id, charge: '12400.0000' })]);
    expect(view.requests.map((row) => [row.status, row.amount, row.paid, row.outstanding, row.hasPendingClaim])).toEqual([
      ['void', '37200.0000', '0', '0.0000', false],
      ['issued', '62000.0000', '2000.0000', '60000.0000', true],
    ]);
    expect(view.requests[1].documentNumber).toMatch(/^PR-\d{4}-\d{4}$/);
    expect(view.requests[1].target).toEqual({ labelAr: null, labelEn: 'Advance' });
    expect(view.payments.rows.map((row) => [row.amount, row.requestNumber])).toEqual([['2000.0000', view.requests[1].documentNumber]]);
  });

  it('pages the ledger 50 at a time by keyset, newest first, with no row twice and none lost', async () => {
    const contract = await seedBillableContract(orgId);
    const sent = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] });
    await ownerQuery(
      `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
       select $1, $2, $3, 1, current_date - (n % 7), $4 from generate_series(1, 120) as n`,
      [orgId, contract.contractId, sent.data, ctx.owner!.userId],
    );
    const first = (await billingOf(contract.contractId)).payments;
    expect(first.rows).toHaveLength(50);
    const second = await loadContractPaymentsCore(ctx.accountant!, { contractId: contract.contractId, cursor: first.nextCursor });
    const third = await loadContractPaymentsCore(ctx.accountant!, { contractId: contract.contractId, cursor: second.data!.nextCursor });
    expect([second.data!.rows.length, third.data!.rows.length, third.data!.nextCursor]).toEqual([50, 20, null]);
    const all = [...first.rows, ...second.data!.rows, ...third.data!.rows];
    expect(new Set(all.map((row) => row.id)).size).toBe(120);
    const keys = all.map((row) => `${row.receivedOn}_${row.id}`);
    expect(keys).toEqual([...keys].sort().reverse());
  });

  it('refuses a role without payments read, a forged cursor, and a contract that is not the caller\'s', async () => {
    const contract = await seedBillableContract(orgId);
    expect(await loadContractBillingCore(ctx.site_engineer!, { contractId: contract.contractId })).toEqual({ ok: false, error: 'forbidden' });
    // The client role is refused by name, whatever the matrix grants it for the portal (S4).
    expect(await loadContractBillingCore(ctx.client!, { contractId: contract.contractId })).toEqual({ ok: false, error: 'forbidden' });
    expect(await loadContractBillingCore(ctx.project_manager!, { contractId: contract.contractId })).toMatchObject({ ok: true });
    for (const cursor of [null, 'x', `2026-02-30_${contract.contractId}`, `2026-01-01_${contract.contractId}_x`]) {
      expect(await loadContractPaymentsCore(ctx.owner!, { contractId: contract.contractId, cursor }), String(cursor)).toEqual({
        ok: false,
        error: 'malformed',
      });
    }
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const foreign = await seedBillableContract(other.orgId);
    expect(await loadContractBillingCore(ctx.owner!, { contractId: foreign.contractId })).toEqual({ ok: false, error: 'record_not_found' });
    expect(
      await loadContractPaymentsCore(ctx.owner!, { contractId: foreign.contractId, cursor: `2026-01-01_${foreign.contractId}` }),
    ).toEqual({ ok: false, error: 'record_not_found' });
  });
});

describe('a Payments-tab write answers with the tab (R1)', () => {
  it('adds the view read after a write that worked, and only then', async () => {
    const contract = await seedBillableContract(orgId);
    const tab = { contractId: contract.contractId };
    const sent = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] });
    const answered = await withBillingView(ctx.accountant!, sent, tab);
    expect(answered).toMatchObject({ ok: true, data: sent.data });
    expect(answered.view?.requests.map((row) => row.id)).toEqual([sent.data]);
    const refused = { ok: false as const, error: 'request_exists' as const };
    expect(await withBillingView(ctx.owner!, refused, tab)).toBe(refused);
  });

  it('a tab the caller cannot read leaves the view out and never turns the write into a failure', async () => {
    const contract = await seedBillableContract(orgId);
    const worked = { ok: true as const, data: 'x' };
    expect(await withBillingView(ctx.owner!, worked, { contractId: 'not-a-uuid' })).toEqual(worked);
    expect(await withBillingView(ctx.site_engineer!, worked, { contractId: contract.contractId })).toEqual(worked);
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const foreign = await seedBillableContract(other.orgId);
    expect(await withBillingView(ctx.owner!, worked, { contractId: foreign.contractId })).toEqual(worked);
  });
});
