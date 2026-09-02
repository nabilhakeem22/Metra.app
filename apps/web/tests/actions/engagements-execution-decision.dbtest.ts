import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import { logPaymentAndAdvanceCore } from '@/lib/engagements/pay-and-advance';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { legalTriggersFrom } from '@/lib/engagements/ui';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// The owner-decision schedule: fee 100k, milestones 30/20/20/30k — the balance
// slice (30k) gates BOTH execution-decision exits.
const WITH_BALANCE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

// A schedule that OMITS the balance (amounts still sum to the fee): under the
// "absent milestone = free gate" rule both choose* clear with no balance payment.
const WITHOUT_BALANCE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '50000' },
  ],
};

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function paymentCount(engagementId: string, kind: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.payment_events
      where engagement_id = '${engagementId}' and kind = '${kind}'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project and drive ONE engagement to
 * `execution_decision` via executeTransition only. `fee` controls whether a
 * balance milestone exists; `gateBAmount` matches the schedule's gate_b slice.
 */
async function setupExecutionDecision(
  fee: GenerateFeeSchedulePayload,
  gateBAmount: string,
): Promise<{ ctx: OrgContext; engagementId: string }> {
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
  });
  const engagementId = (created as { data?: string }).data!;
  await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: fee,
  });
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' });
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await executeTransition(ctx, { engagementId, trigger: 'optionsReady' });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await executeTransition(ctx, { engagementId, trigger: 'selectConcept' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' });
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-alpha',
  });
  await executeTransition(ctx, { engagementId, trigger: 'rendersReady' });
  await setEngagementRomCore(ctx, {
    engagementId,
    romLow: '500000',
    romHigh: '800000',
  });
  await recordRomAcknowledgementCore(ctx, { engagementId });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: gateBAmount });
  await executeTransition(ctx, { engagementId, trigger: 'approveDesign' });
  await recordArtifactCore(ctx, { engagementId, kind: 'shop_drawing' });
  await executeTransition(ctx, { engagementId, trigger: 'draftReady' });
  await recordArtifactCore(ctx, { engagementId, kind: 'boq' });
  await executeTransition(ctx, { engagementId, trigger: 'finalizeBOQ' });
  expect(await stateOf(engagementId)).toBe('execution_decision');
  return { ctx, engagementId };
}

describe('execution decision — the balance gates BOTH exits (owner-locked)', () => {
  it('both choose* fail balance_not_cleared until Σ balance payments ≥ 30k EXACT (scale-4)', async () => {
    const { ctx, engagementId } = await setupExecutionDecision(WITH_BALANCE, '20000');

    // Unpaid: both exits blocked.
    expect(
      await executeTransition(ctx, { engagementId, trigger: 'chooseExecution' }),
    ).toEqual({ ok: false, error: 'balance_not_cleared' });
    expect(
      await executeTransition(ctx, { engagementId, trigger: 'chooseDesignOnly' }),
    ).toEqual({ ok: false, error: 'balance_not_cleared' });
    expect(await stateOf(engagementId)).toBe('execution_decision');

    // Short by a piastre: still blocked, both ways.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'balance',
      amount: '29999.9999',
    });
    expect(
      await executeTransition(ctx, { engagementId, trigger: 'chooseExecution' }),
    ).toEqual({ ok: false, error: 'balance_not_cleared' });
    expect(
      await executeTransition(ctx, { engagementId, trigger: 'chooseDesignOnly' }),
    ).toEqual({ ok: false, error: 'balance_not_cleared' });

    // The remaining piastre clears the gate — Advance continues into execution.
    await recordPaymentCore(ctx, { engagementId, kind: 'balance', amount: '0.0001' });
    const res = await executeTransition(ctx, { engagementId, trigger: 'chooseExecution' });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('execution');
  });

  it('KIND-ISOLATION: a surplus gate_b receipt does NOT satisfy the balance', async () => {
    const { ctx, engagementId } = await setupExecutionDecision(WITH_BALANCE, '20000');
    // Overpay the WRONG kind by more than the whole balance requirement.
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '50000' });

    expect(
      await executeTransition(ctx, { engagementId, trigger: 'chooseExecution' }),
    ).toEqual({ ok: false, error: 'balance_not_cleared' });
    expect(
      await executeTransition(ctx, { engagementId, trigger: 'chooseDesignOnly' }),
    ).toEqual({ ok: false, error: 'balance_not_cleared' });
    expect(await stateOf(engagementId)).toBe('execution_decision');
  });

  it('schedule WITHOUT a balance milestone: both choose* pass unpaid (free gate)', async () => {
    // Free gate into execution…
    const a = await setupExecutionDecision(WITHOUT_BALANCE, '50000');
    expect(await paymentCount(a.engagementId, 'balance')).toBe(0);
    expect(
      (
        await executeTransition(a.ctx, {
          engagementId: a.engagementId,
          trigger: 'chooseExecution',
        })
      ).ok,
    ).toBe(true);
    expect(await stateOf(a.engagementId)).toBe('execution');

    // …and, on a sibling engagement, free gate into the design-only handoff.
    const b = await setupExecutionDecision(WITHOUT_BALANCE, '50000');
    expect(
      (
        await executeTransition(b.ctx, {
          engagementId: b.engagementId,
          trigger: 'chooseDesignOnly',
        })
      ).ok,
    ).toBe(true);
    expect(await stateOf(b.engagementId)).toBe('design_only_handoff');
  });

  it('pay-and-advance: a wrong payment kind is payment_kind_mismatch, NO receipt written', async () => {
    const { ctx, engagementId } = await setupExecutionDecision(WITH_BALANCE, '20000');

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'gate_b',
      amount: '30000',
      advanceTrigger: 'chooseExecution',
    });
    expect(res).toEqual({
      ok: false,
      error: 'payment_kind_mismatch',
      paymentRecorded: false,
    });
    // Rejected BEFORE recording: only the walk's own 20k gate_b receipt exists.
    expect(await paymentCount(engagementId, 'gate_b')).toBe(1);
    expect(await stateOf(engagementId)).toBe('execution_decision');
  });

  it('pay-and-advance accepts kind balance with chooseExecution (MONEY_GUARD_MILESTONE wiring)', async () => {
    const { ctx, engagementId } = await setupExecutionDecision(WITH_BALANCE, '20000');

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'balance',
      amount: '30000',
      advanceTrigger: 'chooseExecution',
    });
    expect(res.ok).toBe(true);
    expect(res.paymentRecorded).toBe(true);
    expect(await paymentCount(engagementId, 'balance')).toBe(1);
    expect(await stateOf(engagementId)).toBe('execution');
  });

  it('gate preview: primaryTrigger is chooseExecution; chooseDesignOnly sits in the legal secondary set', async () => {
    const { ctx, engagementId } = await setupExecutionDecision(WITH_BALANCE, '20000');

    const preview = await getEngagementGatePreview(ctx, engagementId);
    // Advance auto-proposes the execution continuation (owner decision)…
    expect(preview.primaryTrigger).toBe('chooseExecution');
    expect(preview.items).toEqual([
      {
        guard: 'balanceCleared',
        ok: false,
        code: 'balance_not_cleared',
        amountDue: '30000.0000',
      },
    ]);

    // …while the design-only close stays offered as a legal secondary trigger.
    const secondary = legalTriggersFrom('execution_decision').filter(
      (trigger) => trigger !== preview.primaryTrigger,
    );
    expect(secondary).toContain('chooseDesignOnly');
  });
});
