import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import { formatDate } from '@/lib/format/date';
import type { OrgContext } from '@/lib/db/context';
import { recordContractPaymentCore, type RecordContractPaymentInput } from '@/lib/execution/payments/core';
import { voidPaymentRequestCore } from '@/lib/execution/requests/void';
import { seedBillableContract, seedPendingClaim } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A4.2: the execution contract's payment ledger. AC17, AC18 (the core half;
// the grants half is execution-schema.dbtest.ts), and the lock order against a
// concurrent payment.

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'accountant', 'viewer'];
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

/** A request of exactly `amount` on the first row of a signed contract. */
async function requestOf(amount = '500') {
  const contract = await seedBillableContract(orgId);
  const requestId = await seedRequest(orgId, contract.contractId, ctx.owner!.userId, { milestoneId: contract.milestoneIds[0] }, amount);
  return { contract, requestId };
}

/** Two requests of 5,000 on the first two rows of ONE signed contract (seeded in turn: each takes the next number). */
async function twoRequests(): Promise<[string, string]> {
  const contract = await seedBillableContract(orgId);
  const first = await seedRequest(orgId, contract.contractId, ctx.owner!.userId, { milestoneId: contract.milestoneIds[0] }, '5000');
  const second = await seedRequest(orgId, contract.contractId, ctx.owner!.userId, { milestoneId: contract.milestoneIds[1] }, '5000');
  return [first, second];
}

const payment = (requestId: string, fields: Partial<RecordContractPaymentInput> = {}): RecordContractPaymentInput => ({
  requestId,
  amount: '100',
  receivedOn: TODAY,
  idempotencyKey: randomUUID(),
  ...fields,
});

async function ledger(requestId: string) {
  return ownerQuery<{ id: string; amount: string; method: string | null; recorded_by: string }>(
    `select id, amount::text, method, recorded_by::text from public.contract_payments where request_id = $1 order by created_at`,
    [requestId],
  );
}

describe('recordContractPaymentCore', () => {
  it('records a partial payment as typed, then refuses what is past the rest with the rest under the amount (AC17)', async () => {
    const { requestId } = await requestOf();
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '600' }))).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '500.0000' } } },
    });
    const first = await recordContractPaymentCore(ctx.accountant!, payment(requestId, { amount: '١٥٠ EGP', method: 'InstaPay', reference: 'TX-1' }));
    expect(first).toMatchObject({ ok: true, already: false });
    expect(await ledger(requestId)).toEqual([{ id: first.data, amount: '150.0000', method: 'InstaPay', recorded_by: ctx.accountant!.userId }]);
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '350.0001' }))).toMatchObject({
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '350.0000' } } },
    });
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '350' }))).toMatchObject({ ok: true });
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '0.0001' }))).toMatchObject({
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '0.0000' } } },
    });
  });

  it('refuses a payment while the client claim waits (claim_pending_for_request), and on a void request', async () => {
    const claimed = await requestOf();
    await seedPendingClaim(orgId, claimed.contract.contractId, claimed.requestId);
    expect(await recordContractPaymentCore(ctx.owner!, payment(claimed.requestId))).toEqual({ ok: false, error: 'claim_pending_for_request' });
    const voided = await requestOf();
    await voidPaymentRequestCore(ctx.owner!, { requestId: voided.requestId, reason: 'Mistake' });
    expect(await recordContractPaymentCore(ctx.owner!, payment(voided.requestId))).toEqual({ ok: false, error: 'request_void' });
    expect(await ledger(claimed.requestId)).toEqual([]);
    expect(await ledger(voided.requestId)).toEqual([]);
  });

  it('a replayed key answers the first payment with already: true, even once the request is paid in full (AC18)', async () => {
    const { requestId } = await requestOf();
    const input = payment(requestId, { amount: '500' });
    const first = await recordContractPaymentCore(ctx.owner!, input);
    const replay = await recordContractPaymentCore(ctx.owner!, { ...input, amount: '500.0000' });
    expect(replay).toEqual({ ok: true, data: first.data, already: true });
    // The key's upper-case spelling is the same key (S2): never a second payment.
    const shouted = await recordContractPaymentCore(ctx.owner!, { ...input, idempotencyKey: String(input.idempotencyKey).toUpperCase() });
    expect(shouted).toEqual({ ok: true, data: first.data, already: true });
    expect(await ledger(requestId)).toHaveLength(1);
    const [audits] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.audit_log where entity = 'contract_payment' and entity_id = $1`,
      [first.data],
    );
    expect(audits.n).toBe(1);
  });

  it('one key sent twice at once records ONE payment, and both answers name it', async () => {
    const { requestId } = await requestOf();
    const racing = payment(requestId, { amount: '300' });
    const answers = await Promise.all([recordContractPaymentCore(ctx.owner!, racing), recordContractPaymentCore(ctx.admin!, racing)]);
    expect(answers.map((answer) => answer.already).sort()).toEqual([false, true]);
    expect(answers[0].data).toBe(answers[1].data);
    expect(await ledger(requestId)).toHaveLength(1);
  });

  it('two concurrent full payments under two keys: one is recorded, the other is refused under the amount', async () => {
    const { requestId } = await requestOf();
    const results = await Promise.all([ctx.owner!, ctx.accountant!].map((member) => recordContractPaymentCore(member, payment(requestId, { amount: '500' }))));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '0.0000' } } },
    });
    expect(await ledger(requestId)).toHaveLength(1);
  });

  it('says every bad box at once; a bad key or id is malformed; only payments:create may record', async () => {
    const { requestId } = await requestOf();
    expect(
      await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '1,5', receivedOn: '2999-01-01', method: 'm'.repeat(41), reference: 'r'.repeat(121), note: 'n'.repeat(501) })),
    ).toEqual({
      ok: false,
      error: 'check_fields',
      fields: {
        amount: { code: 'not_a_number' },
        receivedOn: { code: 'date_in_future' },
        method: { code: 'too_long', params: { max: 40 } },
        reference: { code: 'too_long', params: { max: 120 } },
        note: { code: 'too_long', params: { max: 500 } },
      },
    });
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '0', receivedOn: '' }))).toMatchObject({
      fields: { amount: { code: 'payment_amount_invalid' }, receivedOn: { code: 'required' } },
    });
    for (const bad of [{ idempotencyKey: 'k-1' }, { idempotencyKey: undefined }, { requestId: 'x' }]) {
      expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, bad))).toEqual({ ok: false, error: 'malformed' });
    }
    for (const role of ['project_manager', 'viewer'] as const) {
      expect(await recordContractPaymentCore(ctx[role]!, payment(requestId))).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await recordContractPaymentCore(ctx.owner!, payment(randomUUID()))).toEqual({ ok: false, error: 'request_not_found' });
    expect(await ledger(requestId)).toEqual([]);
  });

  it('a key that names another payment is refused, never answered as it (F4, S2: idempotency_conflict)', async () => {
    const [a, b] = await twoRequests();
    const key = randomUUID();
    const first = await recordContractPaymentCore(ctx.owner!, payment(a, { amount: '1000', idempotencyKey: key }));
    expect(first).toMatchObject({ ok: true, already: false });
    // Another request under the key, and the same request with another amount.
    expect(await recordContractPaymentCore(ctx.owner!, payment(b, { amount: '1000', idempotencyKey: key }))).toEqual({ ok: false, error: 'idempotency_conflict' });
    expect(await recordContractPaymentCore(ctx.owner!, payment(a, { amount: '999', idempotencyKey: key }))).toEqual({ ok: false, error: 'idempotency_conflict' });
    expect(await ledger(a)).toHaveLength(1);
    expect(await ledger(b)).toEqual([]);
  });

  it('one key raced onto two requests records ONE payment; the other is refused as a conflict', async () => {
    const [a, b] = await twoRequests();
    const key = randomUUID();
    const answers = await Promise.all([
      recordContractPaymentCore(ctx.owner!, payment(a, { amount: '300', idempotencyKey: key })),
      recordContractPaymentCore(ctx.admin!, payment(b, { amount: '300', idempotencyKey: key })),
    ]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.find((answer) => !answer.ok)).toEqual({ ok: false, error: 'idempotency_conflict' });
    expect((await ledger(a)).length + (await ledger(b)).length).toBe(1);
  });

  it('a replay on a void request answers request_void', async () => {
    const [paid, voided] = await twoRequests();
    const key = randomUUID();
    await recordContractPaymentCore(ctx.owner!, payment(paid, { idempotencyKey: key }));
    await voidPaymentRequestCore(ctx.owner!, { requestId: voided, reason: 'Mistake' });
    expect(await recordContractPaymentCore(ctx.owner!, payment(voided, { idempotencyKey: key }))).toEqual({ ok: false, error: 'request_void' });
  });

  it('refuses a day before the contract was issued, before 2000, and a fifth decimal (F5, F8)', async () => {
    const { requestId } = await requestOf();
    const [{ day }] = await ownerQuery<{ day: string }>(
      `select to_char(c.created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day
         from public.contracts c join public.payment_requests r on r.contract_id = c.id where r.id = $1`,
      [requestId],
    );
    expect(day).toBe(TODAY);
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { receivedOn: '2020-01-01' }))).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { receivedOn: { code: 'date_before_issue', params: { date: formatDate(TODAY, 'en') } } },
    });
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { receivedOn: '0026-10-20' }))).toMatchObject({
      fields: { receivedOn: { code: 'invalid_date' } },
    });
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '100.12345' }))).toMatchObject({
      fields: { amount: { code: 'too_many_decimals', params: { max: 4 } } },
    });
    // Both refusals of the request's own figures at once: past what is due, and before the issue day.
    expect(await recordContractPaymentCore(ctx.owner!, payment(requestId, { amount: '501', receivedOn: '2020-01-01' }))).toMatchObject({
      fields: {
        amount: { code: 'payment_exceeds_request', params: { outstanding: '500.0000' } },
        receivedOn: { code: 'date_before_issue' },
      },
    });
    expect(await ledger(requestId)).toEqual([]);
  });
});
