import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { loadContractBillingCore } from '@/lib/execution/billing/read-core';
import { confirmContractClaimCore } from '@/lib/execution/claims/confirm';
import { dismissContractClaimCore } from '@/lib/execution/claims/dismiss';
import { seedPayment } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest } from './execution-fixture';
import { claimBySql, claimsOf, seedExecutionDelivery } from './delivery-execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR B4.2: the studio's answer to a client's "I paid" on a payment request.
// confirmContractClaimCore records the payment and closes the claim in one
// transaction (claim lock, then request lock); dismissContractClaimCore closes
// it with no payment. AC36: a concurrent confirm and dismiss of one claim end
// with exactly one outcome.

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

/** A client claim on a request of `amount` (already paid `paid`), through the /d SQL. */
async function claimed(amount = '37200', paid: string | null = null) {
  const { delivery, contract } = await seedExecutionDelivery(orgId);
  const requestId = await seedRequest(orgId, contract.contractId, ctx.owner!.userId, { milestoneId: contract.milestoneIds[1] }, amount);
  if (paid) await seedPayment(orgId, contract.contractId, requestId, ctx.owner!.userId, paid);
  expect(await claimBySql(delivery.tokenHash, requestId)).toBe('ok');
  const [claim] = await claimsOf(contract.contractId);
  return { delivery, contract, requestId, claimId: claim.id };
}

const paymentsOf = (requestId: string) =>
  ownerQuery<{ id: string; amount: string; recorded_by: string; idempotency_key: string }>(
    `select id, amount::text, recorded_by, idempotency_key from public.contract_payments where request_id = $1`,
    [requestId],
  );

const claimRow = async (claimId: string) =>
  (await ownerQuery<{ status: string; confirmed_payment_id: string | null; resolved_by: string | null }>(
    `select status::text, confirmed_payment_id, resolved_by from public.contract_payment_claims where id = $1`,
    [claimId],
  ))[0];

describe('confirmContractClaimCore', () => {
  it('records the payment in the studio user name and closes the claim; a repeat answers already', async () => {
    const { requestId, claimId, contract } = await claimed('37200', '200');
    const result = await confirmContractClaimCore(ctx.accountant!, { claimId, amount: '37,000' });
    expect(result).toMatchObject({ ok: true, already: false });
    const payment = (await paymentsOf(requestId)).find((row) => row.idempotency_key === `claim:${claimId}`);
    expect(payment).toMatchObject({ id: result.data, amount: '37000.0000', recorded_by: ctx.accountant!.userId, idempotency_key: `claim:${claimId}` });
    expect(await claimRow(claimId)).toEqual({ status: 'confirmed', confirmed_payment_id: result.data, resolved_by: ctx.accountant!.userId });
    expect(await confirmContractClaimCore(ctx.owner!, { claimId, amount: '1' })).toMatchObject({ ok: true, already: true, data: result.data });
    // The 200 recorded before the claim, and the confirmed 37,000: no second row.
    expect(await paymentsOf(requestId)).toHaveLength(2);
    const view = await loadContractBillingCore(ctx.accountant!, { contractId: contract.contractId });
    expect(view.data?.claims).toEqual([]);
  });

  it('takes a part of what is due, and refuses past it under the amount with what is due', async () => {
    const { requestId, claimId } = await claimed('500');
    expect(await confirmContractClaimCore(ctx.owner!, { claimId, amount: '500.0001' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '500.0000' } } },
    });
    expect(await confirmContractClaimCore(ctx.owner!, { claimId, amount: '300' })).toMatchObject({ ok: true });
    expect((await paymentsOf(requestId)).map((row) => row.amount)).toEqual(['300.0000']);
  });

  it('refuses a request paid in full meanwhile, and a void request, writing nothing', async () => {
    const settled = await claimed('500');
    await seedPayment(orgId, settled.contract.contractId, settled.requestId, ctx.owner!.userId, '500');
    expect(await confirmContractClaimCore(ctx.owner!, { claimId: settled.claimId, amount: '1' })).toMatchObject({ ok: false, error: 'claim_already_settled' });
    const voided = await claimed('500');
    await ownerQuery(`update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2 where id = $1`, [voided.requestId, ctx.owner!.userId]);
    expect(await confirmContractClaimCore(ctx.owner!, { claimId: voided.claimId, amount: '1' })).toMatchObject({ ok: false, error: 'request_void' });
    expect(await paymentsOf(voided.requestId)).toEqual([]);
    expect((await claimRow(voided.claimId)).status).toBe('pending');
  });

  it('is refused to the roles that do not record payments, and on malformed input', async () => {
    const { claimId } = await claimed('500');
    for (const role of ['project_manager', 'site_engineer', 'viewer'] as const) {
      expect(await confirmContractClaimCore(ctx[role]!, { claimId, amount: '1' }), role).toMatchObject({ ok: false, error: 'forbidden' });
      expect(await dismissContractClaimCore(ctx[role]!, { claimId }), role).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(await confirmContractClaimCore(ctx.owner!, { claimId: 'x', amount: '1' })).toMatchObject({ error: 'malformed' });
    expect(await confirmContractClaimCore(ctx.owner!, null as never)).toMatchObject({ error: 'malformed' });
    expect(await confirmContractClaimCore(ctx.owner!, { claimId, amount: 'abc' })).toMatchObject({ error: 'check_fields' });
    expect(await dismissContractClaimCore(ctx.owner!, { claimId: 7 })).toMatchObject({ error: 'malformed' });
  });

  it("cannot reach another studio's claim", async () => {
    const { claimId } = await claimed('500');
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
    expect(await confirmContractClaimCore(stranger, { claimId, amount: '1' })).toMatchObject({ ok: false, error: 'claim_not_found' });
    expect(await dismissContractClaimCore(stranger, { claimId })).toMatchObject({ ok: false, error: 'claim_not_found' });
    expect((await claimRow(claimId)).status).toBe('pending');
  });
});

describe('dismissContractClaimCore', () => {
  it('closes the claim with no payment, and the client may claim the request again', async () => {
    const { delivery, requestId, claimId } = await claimed('500');
    expect(await dismissContractClaimCore(ctx.admin!, { claimId })).toEqual({ ok: true });
    expect(await claimRow(claimId)).toEqual({ status: 'dismissed', confirmed_payment_id: null, resolved_by: ctx.admin!.userId });
    expect(await paymentsOf(requestId)).toEqual([]);
    expect(await dismissContractClaimCore(ctx.admin!, { claimId })).toMatchObject({ ok: false, error: 'claim_not_found' });
    expect(await confirmContractClaimCore(ctx.admin!, { claimId, amount: '1' })).toMatchObject({ ok: false, error: 'claim_not_found' });
    expect(await claimBySql(delivery.tokenHash, requestId)).toBe('ok');
  });
});

describe('a concurrent confirm and dismiss of one claim end with exactly one outcome (AC36)', () => {
  it('ten races: a payment and a confirmed claim, or no payment and a dismissed claim, never both', async () => {
    for (let round = 0; round < 10; round += 1) {
      const { requestId, claimId } = await claimed('500');
      const [confirmed, dismissed] = await Promise.all([
        confirmContractClaimCore(ctx.owner!, { claimId, amount: '500' }),
        dismissContractClaimCore(ctx.accountant!, { claimId }),
      ]);
      expect([confirmed.ok, dismissed.ok].filter(Boolean)).toHaveLength(1);
      const loser = confirmed.ok ? dismissed : confirmed;
      expect(loser).toMatchObject({ ok: false, error: 'claim_not_found' });
      const payments = await paymentsOf(requestId);
      const claim = await claimRow(claimId);
      if (confirmed.ok) {
        expect(payments).toHaveLength(1);
        expect(claim).toMatchObject({ status: 'confirmed', confirmed_payment_id: payments[0].id });
      } else {
        expect(payments).toEqual([]);
        expect(claim).toMatchObject({ status: 'dismissed', confirmed_payment_id: null });
      }
    }
  });
});
