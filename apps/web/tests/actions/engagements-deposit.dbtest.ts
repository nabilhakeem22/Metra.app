import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
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

// A 4-milestone PERCENT split: deposit 25% of a 100,000 fee = 25,000 required.
const PERCENT_SPLIT: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'percent', value: '25' },
    { kind: 'gate_a', basis: 'percent', value: '25' },
    { kind: 'gate_b', basis: 'percent', value: '25' },
    { kind: 'balance', basis: 'percent', value: '25' },
  ],
};

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function asBuiltDue(engagementId: string): Promise<boolean> {
  const [row] = await raw.query<{ as_built_due: boolean }>(
    `select as_built_due from public.design_engagements where id = '${engagementId}'`,
  );
  return row.as_built_due;
}

async function depositTransitionCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'confirmAndPayDeposit'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement (optionally Off-Plan) and
 * fire submitDesignFee so it lands in `design_proposal` with the given schedule.
 */
async function setupProposal(opts: {
  offPlan?: boolean;
  split: GenerateFeeSchedulePayload;
}): Promise<{ ctx: OrgContext; engagementId: string }> {
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
    offPlan: opts.offPlan ?? false,
  });
  const engagementId = (created as { data?: string }).data!;
  const submitted = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: opts.split,
  });
  expect(submitted.ok).toBe(true);
  expect(await stateOf(engagementId)).toBe('design_proposal');
  return { ctx, engagementId };
}

function confirmDeposit(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' });
}

describe('recordPayment — append-only ledger', () => {
  it('records a deposit payment that then appears in getEngagementPayments', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    const res = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
      method: 'bank_transfer',
      reference: 'TXN-1',
    });
    expect(res.ok).toBe(true);
    expect(typeof res.data).toBe('string');

    const payments = await getEngagementPayments(ctx, engagementId);
    expect(payments).toHaveLength(1);
    expect(payments[0].kind).toBe('deposit');
    expect(payments[0].amount).toBe('30000.0000');
    expect(payments[0].method).toBe('bank_transfer');
    expect(payments[0].reference).toBe('TXN-1');
  });

  it('rejects a non-positive / malformed amount with payment_amount_invalid', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    for (const amount of ['0', '-5', '1,5', 'abc']) {
      const res = await recordPaymentCore(ctx, {
        engagementId,
        kind: 'deposit',
        amount,
      });
      expect(res).toEqual({ ok: false, error: 'payment_amount_invalid' });
    }
    expect(await getEngagementPayments(ctx, engagementId)).toHaveLength(0);
  });

  it('a direct UPDATE / DELETE under org context is denied (append-only grants)', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
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

    // The row survives both attempts.
    expect(await getEngagementPayments(ctx, engagementId)).toHaveLength(1);
  });

  it('rejects a payment against a terminal (closed / abandoned) engagement', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    // Force a terminal state (abandon isn't wired yet — Step 6+).
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`,
    );
    const res = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
    });
    expect(res.ok).toBe(false);
    expect((res as { error?: string }).error).toBe('engagement_not_active');
    expect(await getEngagementPayments(ctx, engagementId)).toHaveLength(0);
  });
});

describe('confirmAndPayDeposit — gated on the deposit clearing', () => {
  it('with NO deposit paid: deposit_not_cleared, stays design_proposal, no transition', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'deposit_not_cleared' });
    expect(await stateOf(engagementId)).toBe('design_proposal');
    expect(await depositTransitionCount(engagementId)).toBe(0);
  });

  it('with an INSUFFICIENT deposit paid: deposit_not_cleared, no transition', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '29999.9999',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'deposit_not_cleared' });
    expect(await stateOf(engagementId)).toBe('design_proposal');
    expect(await depositTransitionCount(engagementId)).toBe(0);
  });

  it('a SINGLE payment meeting the required amount clears the gate -> survey', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('survey');
    expect(await depositTransitionCount(engagementId)).toBe(1);
  });

  it('a sub-piastre-short deposit does NOT clear (amount stored == amount validated)', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    // 29999.99999 is a shortfall by the app's scale-4 math (truncates to
    // 29999.9999). The value is stored canonically, so the numeric(18,4) column
    // can't round it up to 30000 and let the gate clear.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '29999.99999',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res.ok).toBe(false);
    expect((res as { error?: string }).error).toBe('deposit_not_cleared');
    expect(await stateOf(engagementId)).toBe('design_proposal');
  });

  it('TWO partial payments summing to the required amount clear the gate', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '10000',
    });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '20000',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('survey');
    expect(await depositTransitionCount(engagementId)).toBe(1);
  });

  it('PERCENT basis: 25% of a 100,000 fee = 25,000 required (exact)', async () => {
    const { ctx, engagementId } = await setupProposal({ split: PERCENT_SPLIT });
    // 24,999.9999 is short by a piastre -> denied.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '24999.9999',
    });
    expect(await confirmDeposit(ctx, engagementId)).toEqual({
      ok: false,
      error: 'deposit_not_cleared',
    });
    expect(await stateOf(engagementId)).toBe('design_proposal');

    // A second payment brings the total to exactly 25,000 -> cleared.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '0.0001',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('survey');
  });

  it('a non-deposit payment does NOT count toward the deposit requirement', async () => {
    const { ctx, engagementId } = await setupProposal({ split: AMOUNT_SPLIT });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'gate_a',
      amount: '30000',
    });
    expect(await confirmDeposit(ctx, engagementId)).toEqual({
      ok: false,
      error: 'deposit_not_cleared',
    });
    expect(await stateOf(engagementId)).toBe('design_proposal');
  });
});

describe('confirmAndPayDeposit — Off-Plan side-effect', () => {
  it('Off-Plan engagement: as_built_due becomes true after the deposit clears', async () => {
    const { ctx, engagementId } = await setupProposal({
      offPlan: true,
      split: AMOUNT_SPLIT,
    });
    expect(await asBuiltDue(engagementId)).toBe(false);
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('survey');
    expect(await asBuiltDue(engagementId)).toBe(true);
  });

  it('non-Off-Plan engagement: as_built_due stays false after the deposit clears', async () => {
    const { ctx, engagementId } = await setupProposal({
      offPlan: false,
      split: AMOUNT_SPLIT,
    });
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
    });
    const res = await confirmDeposit(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await asBuiltDue(engagementId)).toBe(false);
  });
});

describe('cross-org isolation', () => {
  it('org B cannot see or record a payment against org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupProposal({
      split: AMOUNT_SPLIT,
    });

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    // A records a real deposit against its own engagement.
    await recordPaymentCore(ctxA, {
      engagementId: aEngagement,
      kind: 'deposit',
      amount: '30000',
    });

    // B reads A's engagement id -> RLS scopes it to an empty ledger.
    expect(await getEngagementPayments(ctxB, aEngagement)).toHaveLength(0);

    // B tries to record against A's engagement -> engagement_not_found (RLS hides it).
    const res = await recordPaymentCore(ctxB, {
      engagementId: aEngagement,
      kind: 'deposit',
      amount: '30000',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });

    // And B cannot advance A's engagement.
    const confirm = await confirmDeposit(ctxB, aEngagement);
    expect(confirm).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(aEngagement)).toBe('design_proposal');
  });
});
