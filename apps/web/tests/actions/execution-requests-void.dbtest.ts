import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { issueMilestoneRequestCore } from '@/lib/execution/requests/issue-milestone';
import { voidPaymentRequestCore } from '@/lib/execution/requests/void';
import { requestRow, seedBillableContract, seedPayment, seedPendingClaim } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A4.1: voiding a payment request. AC15, AC28 (the void half), the A4.1
// addendum (no void under an issued final account; exactly four columns).

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'accountant', 'viewer'];
const REASON = 'Sent to the wrong client';

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

async function sentRequest() {
  const contract = await seedBillableContract(orgId);
  const sent = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] });
  return { contract, requestId: sent.data! };
}

describe('voidPaymentRequestCore', () => {
  it('voids an unpaid request writing only the void columns; the row is requested again under a NEW number (AC15)', async () => {
    const { contract, requestId } = await sentRequest();
    const before = await requestRow(requestId);
    expect(await voidPaymentRequestCore(ctx.accountant!, { requestId, reason: REASON })).toEqual({ ok: true, data: undefined });
    const after = await requestRow(requestId);
    expect(after).toEqual({ ...before, status: 'void', voided: true, voided_by: ctx.accountant!.userId });
    const again = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] });
    expect(again.ok).toBe(true);
    expect((await requestRow(again.data!)).number).toBeGreaterThan(before.number);
    const [audit] = await ownerQuery<{ after: { reason: string } }>(
      `select after from public.audit_log where entity = 'payment_request' and entity_id = $1 and action = 'update'`,
      [requestId],
    );
    expect(audit.after.reason).toBe(REASON);
  });

  it('refuses a request with a payment (request_has_payments) or a pending claim, and a void one', async () => {
    const paid = await sentRequest();
    await seedPayment(orgId, paid.contract.contractId, paid.requestId, ctx.owner!.userId);
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: paid.requestId, reason: REASON })).toEqual({
      ok: false,
      error: 'request_has_payments',
    });
    const claimed = await sentRequest();
    await seedPendingClaim(orgId, claimed.contract.contractId, claimed.requestId);
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: claimed.requestId, reason: REASON })).toEqual({
      ok: false,
      error: 'claim_pending_for_request',
    });
    const once = await sentRequest();
    await voidPaymentRequestCore(ctx.owner!, { requestId: once.requestId, reason: REASON });
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: once.requestId, reason: REASON })).toEqual({
      ok: false,
      error: 'request_void',
    });
    for (const id of [paid.requestId, claimed.requestId]) expect((await requestRow(id)).status).toBe('issued');
  });

  it('refuses a milestone request under an issued final account; voiding the final account reopens it (AC28)', async () => {
    const { contract, requestId } = await sentRequest();
    const finalId = await seedRequest(orgId, contract.contractId, ctx.owner!.userId);
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId, reason: REASON })).toEqual({ ok: false, error: 'final_account_issued' });
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: finalId, reason: REASON })).toMatchObject({ ok: true });
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId, reason: REASON })).toMatchObject({ ok: true });
  });

  it('a void racing a payment: exactly one wins, never a void request holding a payment', async () => {
    const { contract, requestId } = await sentRequest();
    const results = await Promise.allSettled([
      voidPaymentRequestCore(ctx.owner!, { requestId, reason: REASON }),
      seedPayment(orgId, contract.contractId, requestId, ctx.owner!.userId),
    ]);
    const [{ n }] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.contract_payments where request_id = $1`, [requestId]);
    const voided = (await requestRow(requestId)).status === 'void';
    expect(n).toBe(voided ? 0 : 1);
    // The core answers, never throws: `ok`, or `request_has_payments` when the payment won.
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: voided ? { ok: true } : { ok: false, error: 'request_has_payments' } });
  });

  it('needs a reason, refuses roles without invoices_issue, and finds nothing of another studio', async () => {
    const { requestId } = await sentRequest();
    for (const reason of ['', '   ', '​', undefined]) {
      expect(await voidPaymentRequestCore(ctx.owner!, { requestId, reason })).toEqual({
        ok: false,
        error: 'check_fields',
        fields: { reason: { code: 'required' } },
      });
    }
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId, reason: 'x'.repeat(501) })).toMatchObject({
      fields: { reason: { code: 'too_long', params: { max: 500 } } },
    });
    for (const role of ['project_manager', 'viewer'] as const) {
      expect(await voidPaymentRequestCore(ctx[role]!, { requestId, reason: REASON })).toEqual({ ok: false, error: 'forbidden' });
    }
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const foreign = await seedBillableContract(other.orgId);
    const foreignId = await seedRequest(other.orgId, foreign.contractId, other.ownerIds[0], { milestoneId: foreign.milestoneIds[0] });
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: foreignId, reason: REASON })).toEqual({ ok: false, error: 'request_not_found' });
    expect((await requestRow(foreignId)).status).toBe('issued');
    expect((await requestRow(requestId)).status).toBe('issued');
  });
});
