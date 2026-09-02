import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementEvents } from '@/lib/engagements/queries';
import { setEngagementRomCore } from '@/lib/engagements/rom';
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

// A 4-milestone AMOUNT split WITH a gate_b milestone: deposit 30k, gate_a 20k,
// gate_b 20k, balance 30k (fee 100k).
const WITH_GATE_B: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

// A schedule that OMITS gate_b: deposit 30k, gate_a 20k, balance 50k (fee 100k).
// Under the Step-14 "absent milestone = free gate" rule, gate_b clears free here.
const WITHOUT_GATE_B: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '50000' },
  ],
};

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function revisionBookkeeping(
  engagementId: string,
): Promise<{ revisionCount: number; conceptLockedAt: string | null }> {
  const [row] = await raw.query<{
    revision_count: number;
    concept_locked_at: string | null;
  }>(
    `select revision_count, concept_locked_at from public.design_engagements
      where id = '${engagementId}'`,
  );
  return {
    revisionCount: Number(row.revision_count),
    conceptLockedAt: row.concept_locked_at,
  };
}

async function eventCount(engagementId: string, kind: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_events
      where engagement_id = '${engagementId}' and kind = '${kind}'`,
  );
  return Number(row.n);
}

async function transitionCount(
  engagementId: string,
  trigger: string,
): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = '${trigger}'`,
  );
  return Number(row.n);
}

function approveDesign(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'approveDesign' });
}

function rejectDesign(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'rejectDesign' });
}

/** Set a ROM band and record the client's acknowledgement (Gate-B prerequisites). */
async function acknowledgeRom(
  ctx: OrgContext,
  engagementId: string,
): Promise<void> {
  expect(
    (
      await setEngagementRomCore(ctx, {
        engagementId,
        romLow: '500000',
        romHigh: '800000',
      })
    ).ok,
  ).toBe(true);
  expect((await recordRomAcknowledgementCore(ctx, { engagementId })).ok).toBe(true);
}

/**
 * Seed an org + client + project, create ONE engagement (Off-Plan controlled by
 * `offPlan`, fee schedule by `fee`) and drive it to `final_approval`:
 * submitDesignFee -> recordPayment(deposit) -> confirmAndPayDeposit ->
 * recordArtifact(survey) -> spatialBaseReady -> 2 concept_option artifacts ->
 * optionsReady -> recordPayment(gate_a) -> selectConcept -> [`revisions` free
 * requestRevision self-loops] -> confirmConcept -> 2 approved_render artifacts ->
 * rendersReady. Mirrors the Step-13 attestation setup, adding the fee split +
 * an optional run of free revisions to exercise the rejectDesign reset.
 */
async function setupFinalApproval(opts: {
  offPlan?: boolean;
  fee?: GenerateFeeSchedulePayload;
  revisions?: number;
}): Promise<{ ctx: OrgContext; engagementId: string }> {
  const offPlan = opts.offPlan ?? false;
  const fee = opts.fee ?? WITH_GATE_B;
  const revisions = opts.revisions ?? 0;

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
    offPlan,
  });
  const engagementId = (created as { data?: string }).data!;
  expect(
    (
      await executeTransition(ctx, {
        engagementId,
        trigger: 'submitDesignFee',
        payload: fee,
      })
    ).ok,
  ).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' }))
      .ok,
  ).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' })).ok,
  ).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok,
  ).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'selectConcept' })).ok,
  ).toBe(true);
  // Free revisions (within the default allowance of 3) while in negotiation.
  for (let i = 0; i < revisions; i += 1) {
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'requestRevision' })).ok,
    ).toBe(true);
  }
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' })).ok,
  ).toBe(true);
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-alpha',
  });
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-beta',
  });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
  ).toBe(true);
  expect(await stateOf(engagementId)).toBe('final_approval');
  return { ctx, engagementId };
}

describe('approveDesign — Gate B compound guard (non-Off-Plan)', () => {
  it('happy path: ROM ack + gate_b paid -> shop_drawings, one design_approval event, one transition row', async () => {
    const { ctx, engagementId } = await setupFinalApproval({});
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await approveDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await eventCount(engagementId, 'design_approval')).toBe(1);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(1);

    // The design_approval event carries the internal actor and is readable in-org.
    const events = await getEngagementEvents(ctx, engagementId);
    const approval = events.find((e) => e.kind === 'design_approval');
    expect(approval?.actorUserId).toBe(ctx.userId);
  });

  it('with NO rom_acknowledgement: rom_not_acknowledged, stays final_approval, no event', async () => {
    const { ctx, engagementId } = await setupFinalApproval({});
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await approveDesign(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'rom_not_acknowledged' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await eventCount(engagementId, 'design_approval')).toBe(0);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(0);
  });

  it('gate_b milestone present but unpaid / short-by-a-piastre blocks; paid clears', async () => {
    const { ctx, engagementId } = await setupFinalApproval({});
    await acknowledgeRom(ctx, engagementId);

    // Unpaid gate_b: blocked.
    expect(await approveDesign(ctx, engagementId)).toEqual({
      ok: false,
      error: 'gate_b_not_cleared',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');

    // Short by a piastre: still blocked.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'gate_b',
      amount: '19999.9999',
    });
    expect(await approveDesign(ctx, engagementId)).toEqual({
      ok: false,
      error: 'gate_b_not_cleared',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await eventCount(engagementId, 'design_approval')).toBe(0);

    // The remaining piastre clears it.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'gate_b',
      amount: '0.0001',
    });
    const res = await approveDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await eventCount(engagementId, 'design_approval')).toBe(1);
  });

  it('absent gate_b milestone (deposit+gate_a+balance only): gate_b clears FREE', async () => {
    const { ctx, engagementId } = await setupFinalApproval({ fee: WITHOUT_GATE_B });
    await acknowledgeRom(ctx, engagementId);
    // No gate_b payment recorded at all.

    const res = await approveDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await eventCount(engagementId, 'design_approval')).toBe(1);
    // Confirm there was no gate_b receipt: the gate opened for free.
    const [paid] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.payment_events
        where engagement_id = '${engagementId}' and kind = 'gate_b'`,
    );
    expect(Number(paid.n)).toBe(0);
  });

  it('KIND-ISOLATION: a deposit/gate_a payment does NOT satisfy gate_b', async () => {
    const { ctx, engagementId } = await setupFinalApproval({});
    await acknowledgeRom(ctx, engagementId);
    // Overpay the WRONG kinds — must not count toward the gate_b requirement.
    await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '50000' });
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '50000' });

    const res = await approveDesign(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'gate_b_not_cleared' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await eventCount(engagementId, 'design_approval')).toBe(0);
  });
});

describe('approveDesign — Off-Plan as-built reconciliation', () => {
  it('latest attestation is a variance (change_triage): approveDesign is illegal_trigger, then reconcile + approve succeeds', async () => {
    const { ctx, engagementId } = await setupFinalApproval({ offPlan: true });
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    // Flag a variance -> change_triage. approveDesign's from is final_approval only.
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'flagAsBuiltVariance' }))
        .ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('change_triage');

    const wrongFrom = await approveDesign(ctx, engagementId);
    expect(wrongFrom).toEqual({ ok: false, error: 'illegal_trigger' });
    expect(await stateOf(engagementId)).toBe('change_triage');

    // Attest clean -> back to final_approval, latest attestation now reconciled.
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'attestAsBuiltClean' }))
        .ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('final_approval');

    const res = await approveDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await eventCount(engagementId, 'design_approval')).toBe(1);
  });

  it('Off-Plan at final_approval with NO attestation at all: as_built_not_reconciled', async () => {
    const { ctx, engagementId } = await setupFinalApproval({ offPlan: true });
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    const res = await approveDesign(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'as_built_not_reconciled' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await eventCount(engagementId, 'design_approval')).toBe(0);
  });
});

describe('rejectDesign — bounce to negotiation, refill free revisions', () => {
  it('resets revision_count to 0 and reopens the concept lock; requestRevision is free again', async () => {
    // Consume 2 free revisions before Gate B; concept_locked_at is stamped at
    // confirmConcept.
    const { ctx, engagementId } = await setupFinalApproval({ revisions: 2 });
    const before = await revisionBookkeeping(engagementId);
    expect(before.revisionCount).toBe(2);
    expect(before.conceptLockedAt).not.toBeNull();

    const res = await rejectDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect(await transitionCount(engagementId, 'rejectDesign')).toBe(1);

    const after = await revisionBookkeeping(engagementId);
    expect(after.revisionCount).toBe(0);
    expect(after.conceptLockedAt).toBeNull();

    // The free allowance is refilled: a fresh requestRevision is free (no change
    // order), moving the counter 0 -> 1.
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'requestRevision' })).ok,
    ).toBe(true);
    expect((await revisionBookkeeping(engagementId)).revisionCount).toBe(1);
    const [raised] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.engagement_change_orders
        where engagement_id = '${engagementId}'`,
    );
    expect(Number(raised.n)).toBe(0);
  });

  it('rejectDesign has no guard: it fires even with no ROM ack and no gate_b payment', async () => {
    const { ctx, engagementId } = await setupFinalApproval({});
    const res = await rejectDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
  });
});

describe('design_approval event — append-only + cross-org isolation', () => {
  it('a direct UPDATE / DELETE on a design_approval event is denied under the app role; the row survives', async () => {
    const { ctx, engagementId } = await setupFinalApproval({});
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    expect((await approveDesign(ctx, engagementId)).ok).toBe(true);
    expect(await eventCount(engagementId, 'design_approval')).toBe(1);

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.engagement_events set note = 'tampered'
               where engagement_id = '${engagementId}' and kind = 'design_approval'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `delete from public.engagement_events
               where engagement_id = '${engagementId}' and kind = 'design_approval'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    expect(await eventCount(engagementId, 'design_approval')).toBe(1);
  });

  it('org B cannot approveDesign on org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupFinalApproval({});
    await acknowledgeRom(ctxA, aEngagement);
    await recordPaymentCore(ctxA, {
      engagementId: aEngagement,
      kind: 'gate_b',
      amount: '20000',
    });

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await approveDesign(ctxB, aEngagement);
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(aEngagement)).toBe('final_approval');
    expect(await eventCount(aEngagement, 'design_approval')).toBe(0);
    expect(await transitionCount(aEngagement, 'approveDesign')).toBe(0);
    expect(await getEngagementEvents(ctxB, aEngagement)).toHaveLength(0);
  });
});
