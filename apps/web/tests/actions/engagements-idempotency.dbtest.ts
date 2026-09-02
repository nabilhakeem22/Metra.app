import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { logPaymentAndAdvanceCore } from '@/lib/engagements/pay-and-advance';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementPayments } from '@/lib/engagements/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A 4-milestone AMOUNT split whose deposit requires 30,000 (fee 100,000).
const AMOUNT_SPLIT: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

/** Number of payment_events rows for an engagement (over the BYPASSRLS conn). */
async function paymentRowCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.payment_events
     where engagement_id = '${engagementId}'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement and fire submitDesignFee
 * so it lands in `design_proposal` with the AMOUNT split (deposit = 30,000).
 */
async function setupProposal(): Promise<{
  ctx: OrgContext;
  engagementId: string;
  orgId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
    offPlan: false,
  });
  const engagementId = (created as { data?: string }).data!;
  const submitted = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: AMOUNT_SPLIT,
  });
  expect(submitted.ok).toBe(true);
  expect(await stateOf(engagementId)).toBe('design_proposal');
  return { ctx, engagementId, orgId };
}

describe('recordPayment idempotency — the partial unique key', () => {
  it('(1) the SAME key twice records ONE row; both ok, 2nd already:true, same id', async () => {
    const { ctx, engagementId } = await setupProposal();
    const key = randomUUID();

    const first = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: key,
    });
    const second = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: key,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.already).toBe(false);
    expect(second.already).toBe(true);
    expect(second.data).toBe(first.data);
    expect(await paymentRowCount(engagementId)).toBe(1);
  });

  it('(2) two DIFFERENT keys record TWO rows', async () => {
    const { ctx, engagementId } = await setupProposal();

    const a = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '10000',
      idempotencyKey: randomUUID(),
    });
    const b = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '20000',
      idempotencyKey: randomUUID(),
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.already).toBe(false);
    expect(b.already).toBe(false);
    expect(b.data).not.toBe(a.data);
    expect(await paymentRowCount(engagementId)).toBe(2);
  });

  it('(3) KEYLESS twice records TWO rows (back-compat, append-only)', async () => {
    const { ctx, engagementId } = await setupProposal();

    const a = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '10000',
    });
    const b = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '10000',
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.already).toBe(false);
    expect(b.already).toBe(false);
    expect(await paymentRowCount(engagementId)).toBe(2);
  });

  it('(4) FIRST-WRITE-WINS: key K at 30000 then key K at 20000 -> one row, amount 30000', async () => {
    const { ctx, engagementId } = await setupProposal();
    const key = randomUUID();

    const first = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: key,
    });
    const second = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '20000',
      idempotencyKey: key,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.already).toBe(true);
    expect(second.data).toBe(first.data);

    const payments = await getEngagementPayments(ctx, engagementId);
    expect(payments).toHaveLength(1);
    // The stored amount is the FIRST write's — the replay never overwrote it.
    expect(payments[0].amount).toBe('30000.0000');
  });

  it('rejects a present-but-non-UUID key with a coded invalid (no row)', async () => {
    const { ctx, engagementId } = await setupProposal();
    const res = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: 'not-a-uuid',
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(await paymentRowCount(engagementId)).toBe(0);
  });

  it('an empty / whitespace key is treated as keyless (records normally)', async () => {
    const { ctx, engagementId } = await setupProposal();
    const res = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: '   ',
    });
    expect(res.ok).toBe(true);
    expect(res.already).toBe(false);
    expect(await paymentRowCount(engagementId)).toBe(1);
  });
});

describe('logPaymentAndAdvance idempotency + kind-guard', () => {
  it('(5) combined same key + SHORT deposit: ONE row, guard re-checked, stays design_proposal', async () => {
    const { ctx, engagementId } = await setupProposal();
    const key = randomUUID();

    // 29,999 is short of the 30,000 deposit -> the advance guard blocks.
    const first = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'deposit',
      amount: '29999',
      advanceTrigger: 'confirmAndPayDeposit',
      idempotencyKey: key,
    });
    const second = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'deposit',
      amount: '29999',
      advanceTrigger: 'confirmAndPayDeposit',
      idempotencyKey: key,
    });

    // Both persisted the (same) payment; both blocked on deposit_not_cleared.
    expect(first.paymentRecorded).toBe(true);
    expect(second.paymentRecorded).toBe(true);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(first.error).toBe('deposit_not_cleared');
    expect(second.error).toBe('deposit_not_cleared');
    // Deterministic: one payment row, still in design_proposal.
    expect(await paymentRowCount(engagementId)).toBe(1);
    expect(await stateOf(engagementId)).toBe('design_proposal');
  });

  it('(6) combined key that CLEARS + retry same key: ONE row, advanced, no error thrown', async () => {
    const { ctx, engagementId } = await setupProposal();
    const key = randomUUID();

    const first = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'deposit',
      amount: '30000',
      advanceTrigger: 'confirmAndPayDeposit',
      idempotencyKey: key,
    });
    expect(first.ok).toBe(true);
    expect(first.paymentRecorded).toBe(true);
    expect(await stateOf(engagementId)).toBe('survey');

    // Retry with the same key: the payment dedups (one row) and the transition is
    // a benign no-op (engagement already left design_proposal -> illegal_trigger),
    // never a throw.
    const second = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'deposit',
      amount: '30000',
      advanceTrigger: 'confirmAndPayDeposit',
      idempotencyKey: key,
    });
    expect(second.paymentRecorded).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('illegal_trigger');
    expect(await paymentRowCount(engagementId)).toBe(1);
    expect(await stateOf(engagementId)).toBe('survey');
  });

  it('(7) mismatched kind (gate_a paired with confirmAndPayDeposit) -> payment_kind_mismatch, ZERO rows', async () => {
    const { ctx, engagementId } = await setupProposal();

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'gate_a',
      amount: '30000',
      advanceTrigger: 'confirmAndPayDeposit',
      idempotencyKey: randomUUID(),
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('payment_kind_mismatch');
    expect(res.paymentRecorded).toBe(false);
    expect(await paymentRowCount(engagementId)).toBe(0);
    expect(await stateOf(engagementId)).toBe('design_proposal');
  });
});

describe('idempotency key is org-scoped', () => {
  it('(8) org A key K and org B key K coexist (org-scoped partial index)', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupProposal();
    const { ctx: ctxB, engagementId: bEngagement } = await setupProposal();
    const key = randomUUID();

    const a = await recordPaymentCore(ctxA, {
      engagementId: aEngagement,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: key,
    });
    const b = await recordPaymentCore(ctxB, {
      engagementId: bEngagement,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: key,
    });

    // The SAME key lands as a fresh write in each tenant — neither dedups.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.already).toBe(false);
    expect(b.already).toBe(false);
    expect(a.data).not.toBe(b.data);
    expect(await paymentRowCount(aEngagement)).toBe(1);
    expect(await paymentRowCount(bEngagement)).toBe(1);
  });
});

describe('payment_events stays append-only (no UPDATE/DELETE grant)', () => {
  it('(9) a direct UPDATE / DELETE under org context is denied, keyed row survives', async () => {
    const { ctx, engagementId } = await setupProposal();
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      idempotencyKey: randomUUID(),
    });

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.payment_events set amount = 1 where engagement_id = '${engagementId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `delete from public.payment_events where engagement_id = '${engagementId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    expect(await paymentRowCount(engagementId)).toBe(1);
  });
});
