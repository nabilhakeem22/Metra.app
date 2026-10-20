import { randomUUID } from 'node:crypto';
import { createSql, type MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { checkPaymentAttemptCore } from '@/lib/execution/payments/check-attempt';
import { recordContractPaymentCore } from '@/lib/execution/payments/core';
import { todayInCairo } from '@/lib/automation/clock';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, seedRequest } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// A4 N1: "Check the payments" asks behind the request's row lock whether an
// earlier attempt landed. It must queue behind a writer of that request that
// is still running and answer what that writer committed; a writer that holds
// the lock past the app's lock_timeout makes the check `uncertain`, never
// "not there".

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const TODAY = todayInCairo(new Date());
// The other writer: its own connection, as the table owner, holding the row lock.
const writer = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  ctx.owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  ctx.project_manager = ctxFor(orgId, seeded.memberIds[0], 'project_manager');
});

afterAll(async () => {
  await writer.end();
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

async function requestOf() {
  const contract = await seedBillableContract(orgId);
  const requestId = await seedRequest(orgId, contract.contractId, ctx.owner!.userId, { milestoneId: contract.milestoneIds[0] }, '5000');
  return { contractId: contract.contractId, requestId };
}

/** A writer that takes the request FOR UPDATE, records a payment under `key` and commits after `holdMs`. */
function slowPayment(target: { contractId: string; requestId: string }, key: string, holdMs: number) {
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => (locked = resolve));
  const committed = writer
    .begin(async (tx) => {
      await tx`select id from public.payment_requests where id = ${target.requestId} for update`;
      locked();
      await tx`insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by, idempotency_key)
               values (${orgId}, ${target.contractId}, ${target.requestId}, 5000, ${TODAY}, ${ctx.owner!.userId}, ${key})`;
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    })
    .then(() => Date.now());
  return { hasLock, committed };
}

describe('checkPaymentAttemptCore', () => {
  it('says whether the key landed: not before the payment, yes after it, whatever the spelling of the key', async () => {
    const target = await requestOf();
    const key = randomUUID();
    expect(await checkPaymentAttemptCore(ctx.owner!, { requestId: target.requestId, idempotencyKey: key })).toEqual({ ok: true, data: { landed: false } });
    await recordContractPaymentCore(ctx.owner!, { requestId: target.requestId, amount: '1000', receivedOn: TODAY, idempotencyKey: key });
    expect(await checkPaymentAttemptCore(ctx.owner!, { requestId: target.requestId, idempotencyKey: key.toUpperCase() })).toEqual({ ok: true, data: { landed: true } });
  });

  it('queues behind a writer of the request that is still running, and answers what it committed', async () => {
    const target = await requestOf();
    const key = randomUUID();
    const first = slowPayment(target, key, 1500);
    await first.hasLock;
    const asked = Date.now();
    const answer = await checkPaymentAttemptCore(ctx.owner!, { requestId: target.requestId, idempotencyKey: key });
    const answered = Date.now();
    // A read that did not wait would have answered "not there" at once: the row was uncommitted.
    expect(answer).toEqual({ ok: true, data: { landed: true } });
    expect(answered - asked).toBeGreaterThanOrEqual(1000);
    await first.committed;
  });

  it('a writer that holds the lock past lock_timeout makes the check uncertain, never "not there"', async () => {
    const target = await requestOf();
    const key = randomUUID();
    const first = slowPayment(target, key, 6500);
    await first.hasLock;
    expect(await checkPaymentAttemptCore(ctx.owner!, { requestId: target.requestId, idempotencyKey: key })).toEqual({ ok: false, error: 'uncertain' });
    await first.committed;
    expect(await checkPaymentAttemptCore(ctx.owner!, { requestId: target.requestId, idempotencyKey: key })).toEqual({ ok: true, data: { landed: true } });
  }, 20_000);

  it('is gated as recording a payment, refuses what no form sends, and sees no other studio', async () => {
    const target = await requestOf();
    const key = randomUUID();
    expect(await checkPaymentAttemptCore(ctx.project_manager!, { requestId: target.requestId, idempotencyKey: key })).toEqual({ ok: false, error: 'forbidden' });
    for (const bad of [null, {}, { requestId: target.requestId }, { requestId: 'x', idempotencyKey: key }, { requestId: target.requestId, idempotencyKey: 42 }]) {
      expect(await checkPaymentAttemptCore(ctx.owner!, bad as never), JSON.stringify(bad)).toEqual({ ok: false, error: 'malformed' });
    }
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const foreign = await seedBillableContract(other.orgId);
    const foreignRequest = await seedRequest(other.orgId, foreign.contractId, other.ownerIds[0], { milestoneId: foreign.milestoneIds[0] }, '5000');
    expect(await checkPaymentAttemptCore(ctx.owner!, { requestId: foreignRequest, idempotencyKey: key })).toEqual({ ok: false, error: 'request_not_found' });
  });
});
