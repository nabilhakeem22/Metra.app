import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementChangeOrders } from '@/lib/engagements/queries';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import type {
  GenerateFeeSchedulePayload,
  RequestRevisionPayload,
} from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

// THE 3D REVISION LOOP (`designChangeRaised`): final_approval / shop_drawings ->
// design_3d, so the studio can act on a client's "request design changes" and
// RE-ISSUE a revised 3D. It is guard-less and REUSES the concept stage's
// `applyRevision` side-effect, so the commercial RULE is identical — N free
// revisions, then a priced change order — but it spends its OWN allowance
// (`design_revision_count` / `free_design_revision_n`, default 3). This file proves
// the loop end-to-end against a real DB: the two allowances are independent, the
// 4th 3D revision is priced, and the commercial hole the loop opens — a priced 3D
// change order must be settled before `approveDesign` can close the design phase.
//
// Clones the gate-b / revision harness (setup, helpers, isolation shape).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A 4-milestone AMOUNT split: deposit 30k, gate_a 20k, gate_b 20k, balance 30k
// (fee 100k) — the same schedule the Gate-B suite drives.
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

/** The CONCEPT counter — spent by `requestRevision`, never by the 3D loop. */
async function revisionCountOf(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select revision_count::int as n from public.design_engagements where id = '${engagementId}'`,
  );
  return Number(row.n);
}

/** The 3D counter — spent by `designChangeRaised`, never by the concept loop. */
async function designRevisionCountOf(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select design_revision_count::int as n from public.design_engagements
      where id = '${engagementId}'`,
  );
  return Number(row.n);
}

async function changeOrderCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_change_orders
      where engagement_id = '${engagementId}'`,
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

async function eventCount(engagementId: string, kind: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_events
      where engagement_id = '${engagementId}' and kind = '${kind}'`,
  );
  return Number(row.n);
}

function designChangeRaised(
  ctx: OrgContext,
  engagementId: string,
  payload?: RequestRevisionPayload,
) {
  return executeTransition(ctx, {
    engagementId,
    trigger: 'designChangeRaised',
    payload,
  });
}

function approveDesign(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'approveDesign' });
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
 * Seed an org + client + project, create ONE (non-Off-Plan) engagement and drive
 * it to `final_approval`: submitDesignFee -> recordPayment(deposit) ->
 * confirmAndPayDeposit -> recordArtifact(survey) -> spatialBaseReady -> 2
 * concept_option artifacts -> optionsReady -> recordPayment(gate_a) ->
 * selectConcept -> [`revisions` FREE requestRevision self-loops] ->
 * confirmConcept -> 2 approved_render artifacts -> rendersReady, then
 * [`designRevisions` FREE designChangeRaised/rendersReady round trips].
 *
 * `revisions` seeds the CONCEPT counter and `designRevisions` the 3D counter, so a
 * test can start either inside a free allowance (default 3 each) or exactly at its
 * edge — INDEPENDENTLY, which is the whole point of the two counters. Either way
 * the engagement ends at `final_approval`.
 */
async function setupFinalApproval(
  opts: { revisions?: number; designRevisions?: number } = {},
): Promise<{ ctx: OrgContext; engagementId: string }> {
  const revisions = opts.revisions ?? 0;
  const designRevisions = opts.designRevisions ?? 0;

  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme' });
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
  expect(
    (
      await executeTransition(ctx, {
        engagementId,
        trigger: 'submitDesignFee',
        payload: AMOUNT_SPLIT,
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

  // Burn `designRevisions` FREE 3D revisions the way the studio actually does:
  // designChangeRaised (-> design_3d) then rendersReady (-> final_approval). The
  // approved renders are already recorded, so the re-issue needs no new artifact.
  for (let i = 0; i < designRevisions; i += 1) {
    expect((await designChangeRaised(ctx, engagementId)).ok).toBe(true);
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
    ).toBe(true);
  }
  expect(await designRevisionCountOf(engagementId)).toBe(designRevisions);
  expect(await stateOf(engagementId)).toBe('final_approval');
  return { ctx, engagementId };
}

describe('designChangeRaised — within the free allowance', () => {
  it('sends the engagement back to design_3d, increments the 3D counter, raises NO change order', async () => {
    const { ctx, engagementId } = await setupFinalApproval();
    expect(await designRevisionCountOf(engagementId)).toBe(0);

    const res = await designChangeRaised(ctx, engagementId, {
      reason: 'Client wants a warmer palette in the living room',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await designRevisionCountOf(engagementId)).toBe(1);
    // The CONCEPT counter is untouched — the 3D loop never spends it.
    expect(await revisionCountOf(engagementId)).toBe(0);
    expect(await changeOrderCount(engagementId)).toBe(0);
    expect(await transitionCount(engagementId, 'designChangeRaised')).toBe(1);
  });

  it('the revised 3D can be RE-ISSUED: rendersReady runs again, back to final_approval', async () => {
    // This is the whole point of the loop — "re-upload the 3D, or any file the
    // client asked changes on" — so prove the round trip, not just the way back.
    const { ctx, engagementId } = await setupFinalApproval();
    expect((await designChangeRaised(ctx, engagementId)).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');

    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'approved_render',
      contentHash: 'hash-revised',
    });
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await transitionCount(engagementId, 'rendersReady')).toBe(2);
  });

  it('is legal from shop_drawings too (the client asked after Gate B closed)', async () => {
    const { ctx, engagementId } = await setupFinalApproval();
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
    expect((await approveDesign(ctx, engagementId)).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');

    const res = await designChangeRaised(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await designRevisionCountOf(engagementId)).toBe(1);
    expect(await changeOrderCount(engagementId)).toBe(0);
  });
});

describe('the 3D allowance is INDEPENDENT of the concept allowance', () => {
  it('a FULLY-BURNED concept allowance still gets all 3 free 3D revisions', async () => {
    // THE BUG THE OWNER FIXED: with one shared counter, an engagement that used
    // its 3 free concept revisions arrived at the 3D stage with ZERO free 3D
    // revisions — the client was charged a change order for the very first "can
    // you warm up the render?". Now the two allowances never draw on each other.
    const { ctx, engagementId } = await setupFinalApproval({ revisions: 3 });
    expect(await revisionCountOf(engagementId)).toBe(3);
    // …and burning the concept allowance spent NONE of the 3D one.
    expect(await designRevisionCountOf(engagementId)).toBe(0);

    for (let expected = 1; expected <= 3; expected += 1) {
      // No amount supplied: each of these must be FREE.
      const res = await designChangeRaised(ctx, engagementId, {
        reason: `Free 3D revision ${expected}`,
      });
      expect(res.ok).toBe(true);
      expect(await stateOf(engagementId)).toBe('design_3d');
      expect(await designRevisionCountOf(engagementId)).toBe(expected);
      // Not one piastre charged, and the concept counter never moves.
      expect(await changeOrderCount(engagementId)).toBe(0);
      expect(await revisionCountOf(engagementId)).toBe(3);

      // Re-issue the revised 3D so the next round trip starts from final_approval.
      expect(
        (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
      ).toBe(true);
      expect(await stateOf(engagementId)).toBe('final_approval');
    }

    // Only the 4th 3D revision is priced — the allowance is 3, counted on its own.
    expect(await designChangeRaised(ctx, engagementId)).toEqual({
      ok: false,
      error: 'revision_co_amount_required',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await designRevisionCountOf(engagementId)).toBe(3);
  });

  it('a 3D revision never consumes the concept allowance (and vice versa)', async () => {
    // Start with BOTH allowances part-spent at different depths, then move each
    // counter once and prove the other is untouched.
    const { ctx, engagementId } = await setupFinalApproval({
      revisions: 2,
      designRevisions: 1,
    });
    expect(await revisionCountOf(engagementId)).toBe(2);
    expect(await designRevisionCountOf(engagementId)).toBe(1);

    expect((await designChangeRaised(ctx, engagementId)).ok).toBe(true);
    expect(await designRevisionCountOf(engagementId)).toBe(2);
    expect(await revisionCountOf(engagementId)).toBe(2);
    expect(await changeOrderCount(engagementId)).toBe(0);
  });

  it('rejectDesign refills ONLY the concept allowance — 3D revisions stay spent', async () => {
    // The owner-locked reject rule is unchanged by the split: bouncing the design
    // back to negotiation hands back the free CONCEPT revisions (that is the stage
    // being re-opened) and leaves `design_revision_count` where it was.
    const { ctx, engagementId } = await setupFinalApproval({
      revisions: 3,
      designRevisions: 2,
    });

    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'rejectDesign' })).ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect(await revisionCountOf(engagementId)).toBe(0);
    expect(await designRevisionCountOf(engagementId)).toBe(2);
  });
});

describe('designChangeRaised — concurrency', () => {
  it('two concurrent calls: the state gate admits ONE, and the 3D counter moves once', async () => {
    // The concept self-loop (negotiation -> negotiation) does NOT serialize at the
    // executor's state gate, which is why `applyRevision` increments at the DB —
    // that regression test lives in engagements-revision.dbtest.ts and still guards
    // the concept counter. This edge DOES change state (final_approval ->
    // design_3d), so the gate admits exactly one caller; the same atomic `UPDATE …
    // RETURNING` must leave the 3D counter at exactly 1, never 2.
    const { ctx, engagementId } = await setupFinalApproval();

    const results = await Promise.all([
      designChangeRaised(ctx, engagementId),
      designChangeRaised(ctx, engagementId),
    ]);
    expect(results.filter((res) => res.ok)).toHaveLength(1);
    // The LOSER's code is interleaving-dependent, and BOTH outcomes are correct:
    // the executor pre-reads the row for its guards, so depending on whether the
    // winner's commit lands before or after that read, the loser is rejected
    // either by the atomic state gate (`engagement_state_conflict`) or by the
    // legal-from-current-state check (`illegal_trigger`). Pinning one specific
    // code makes this a coin flip — it passed on a branch and failed on main.
    // The SAFETY invariant is what matters and is asserted below: exactly one
    // winner, one counter increment, one transition row, no change order.
    const losers = results.filter((res) => !res.ok);
    expect(losers).toHaveLength(1);
    expect(['engagement_state_conflict', 'illegal_trigger']).toContain(
      (losers[0] as { ok: false; error: string }).error,
    );
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await designRevisionCountOf(engagementId)).toBe(1);
    expect(await transitionCount(engagementId, 'designChangeRaised')).toBe(1);
    expect(await changeOrderCount(engagementId)).toBe(0);
  });
});

describe('designChangeRaised — past the 3D free allowance (N=3)', () => {
  it('the 4th 3D revision with NO amount: revision_co_amount_required, and NOTHING moves (atomic rollback)', async () => {
    const { ctx, engagementId } = await setupFinalApproval({ designRevisions: 3 });
    expect(await designRevisionCountOf(engagementId)).toBe(3);

    const res = await designChangeRaised(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'revision_co_amount_required' });
    // The state move, the counter increment and the transition row all roll back.
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await designRevisionCountOf(engagementId)).toBe(3);
    expect(await changeOrderCount(engagementId)).toBe(0);
    expect(await transitionCount(engagementId, 'designChangeRaised')).toBe(3);
  });

  it('a malformed (comma-decimal) amount is rejected, nothing written', async () => {
    const { ctx, engagementId } = await setupFinalApproval({ designRevisions: 3 });
    const res = await designChangeRaised(ctx, engagementId, {
      changeOrderAmount: '1,5',
    });
    expect(res).toEqual({ ok: false, error: 'revision_co_amount_required' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await designRevisionCountOf(engagementId)).toBe(3);
    expect(await changeOrderCount(engagementId)).toBe(0);
  });

  it('with a valid amount: moves to design_3d and raises exactly ONE raised change order', async () => {
    const { ctx, engagementId } = await setupFinalApproval({ designRevisions: 3 });

    const res = await designChangeRaised(ctx, engagementId, {
      changeOrderAmount: '4500.25',
      reason: 'Full re-render of the reception',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await designRevisionCountOf(engagementId)).toBe(4);
    expect(await transitionCount(engagementId, 'designChangeRaised')).toBe(4);

    const orders = await getEngagementChangeOrders(ctx, engagementId);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('raised');
    expect(orders[0].amount).toBe('4500.2500');
    expect(orders[0].reason).toBe('Full re-render of the reception');
    expect(orders[0].raisedByUserId).toBe(ctx.userId);
    expect(orders[0].settledAt).toBeNull();
  });
});

describe('approveDesign — an unsettled 3D change order blocks Gate B', () => {
  it('blocks with revision_cos_outstanding, then passes once a revision_co receipt covers it', async () => {
    // The hole this closes: reaching design_3d and advancing again goes
    // rendersReady -> final_approval -> approveDesign, and NOTHING on that path
    // used to re-check change orders — so a priced 3D change order could go
    // uncollected while the design was approved.
    const { ctx, engagementId } = await setupFinalApproval({ designRevisions: 3 });
    expect(
      (await designChangeRaised(ctx, engagementId, { changeOrderAmount: '4500.25' }))
        .ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');

    // Re-issue the revised 3D and come back to the Gate-B decision.
    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'approved_render',
      contentHash: 'hash-revised',
    });
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
    ).toBe(true);
    expect(await stateOf(engagementId)).toBe('final_approval');

    // Every OTHER Gate-B guard is satisfied — only the 3D change order is open.
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    expect(await approveDesign(ctx, engagementId)).toEqual({
      ok: false,
      error: 'revision_cos_outstanding',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await eventCount(engagementId, 'design_approval')).toBe(0);
    expect(await transitionCount(engagementId, 'approveDesign')).toBe(0);

    // KIND-ISOLATION: a gate_b overpayment of the same size does NOT settle it.
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '4500.25' });
    expect(await approveDesign(ctx, engagementId)).toEqual({
      ok: false,
      error: 'revision_cos_outstanding',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');

    // Short by a piastre: still blocked.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'revision_co',
      amount: '4500.2499',
    });
    expect(await approveDesign(ctx, engagementId)).toEqual({
      ok: false,
      error: 'revision_cos_outstanding',
    });
    expect(await stateOf(engagementId)).toBe('final_approval');

    // The remaining piastre clears it and Gate B closes.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'revision_co',
      amount: '0.0001',
    });
    const res = await approveDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await eventCount(engagementId, 'design_approval')).toBe(1);
  });

  it('a FREE 3D revision leaves Gate B open — no change order, nothing to settle', async () => {
    // Existing engagements are unaffected: confirmConcept already forces
    // settlement before design_3d is reachable, so only a NEWLY-raised 3D change
    // order can be outstanding at final_approval.
    const { ctx, engagementId } = await setupFinalApproval();
    expect((await designChangeRaised(ctx, engagementId)).ok).toBe(true);
    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'approved_render',
      contentHash: 'hash-revised',
    });
    expect(
      (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
    ).toBe(true);
    await acknowledgeRom(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });

    expect(await changeOrderCount(engagementId)).toBe(0);
    const res = await approveDesign(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
  });
});

describe('designChangeRaised — cross-org isolation', () => {
  it('org B cannot raise a design change on org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupFinalApproval({
      designRevisions: 3,
    });

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await designChangeRaised(ctxB, aEngagement, {
      changeOrderAmount: '9999',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(aEngagement)).toBe('final_approval');
    expect(await designRevisionCountOf(aEngagement)).toBe(3);
    expect(await changeOrderCount(aEngagement)).toBe(0);
    expect(await transitionCount(aEngagement, 'designChangeRaised')).toBe(3);
    expect(await getEngagementChangeOrders(ctxB, aEngagement)).toHaveLength(0);

    // …and the refusal was TENANCY, not a broken edge: A fires the same call fine.
    expect(
      (await designChangeRaised(ctxA, aEngagement, { changeOrderAmount: '9999' }))
        .ok,
    ).toBe(true);
    expect(await stateOf(aEngagement)).toBe('design_3d');
    expect(await changeOrderCount(aEngagement)).toBe(1);
    expect(await getEngagementChangeOrders(ctxB, aEngagement)).toHaveLength(0);
  });
});
