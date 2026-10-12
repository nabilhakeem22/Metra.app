import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '@metra/db';
import { setArtifactClientVisibilityCore } from '@/lib/engagements/client-visibility';
import { respondToDesignAndNotify } from '@/lib/engagements/client-acts/design-acts';
import { reviewSeenOf } from '@/lib/engagements/review-seen';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, teardown } from './fixture';
import { forceState, rendersReadyAtText, seedArtifact, seedRoundBDelivery, stampRenders, type RoundBDelivery } from './round-b-fixture';

// Round D, A1 under the owner's decision of the D3 fix round: a render shown
// to the client starts a new round ONLY while the client has not decided on
// the current one, at final_approval and at change_triage. Once an approval
// (or a change request) is on file, a render shown later leaves it standing.
// The two forced interleavings hold a second connection's transaction open
// while the studio shows a render: neither a state move nor a client decision
// committed during the lock wait is missed.

const orgIds: string[] = [];
const holder = createSql(process.env.DATABASE_URL as string, { max: 1 });
afterAll(async () => {
  await teardown(orgIds);
  await holder.end();
  await closeFixture();
});

async function atFinalApproval(suffix: string): Promise<RoundBDelivery> {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await forceState(d.engagementId, 'final_approval');
  await stampRenders(d.engagementId, `now() - interval '1 hour'`);
  return d;
}

const seenNow = async (d: RoundBDelivery) => reviewSeenOf((await deliveryOrNull(d.token))!);
const decisionOnPage = async (d: RoundBDelivery) => (await deliveryOrNull(d.token))!.designDecision?.kind ?? null;

/** Show a NEW render while `other` holds a transaction open on another connection; `other` commits mid-flight. */
async function showWhileHeld(d: RoundBDelivery, other: string): Promise<void> {
  const artifactId = await seedArtifact(d, 'approved_render', { release: false });
  let release!: () => void;
  const held = holder.begin(async (tx) => {
    await tx.unsafe(other);
    await new Promise<void>((resolve) => (release = resolve));
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  let settled = false;
  const flip = setArtifactClientVisibilityCore(d.ctx, { artifactId, visible: true }).finally(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(settled).toBe(false); // it waits on the row the other transaction holds
  release();
  await held;
  expect((await flip).ok).toBe(true);
}

describe('a render shown BEFORE the client decided starts a new round', () => {
  it('at final_approval: re-stamped; a page from before it answers changed', async () => {
    const d = await atFinalApproval('rr-before');
    const seen = await seenNow(d);
    await seedArtifact(d, 'approved_render');
    expect((await seenNow(d)).rendersIssuedAt).not.toBe(seen.rendersIssuedAt);
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' }, seen)).toEqual({ kind: 'changed' });
  });

  it('at change_triage (F2): re-stamped, so back at final_approval the stale page answers changed', async () => {
    const d = await atFinalApproval('rr-triage');
    const seen = await seenNow(d);
    await forceState(d.engagementId, 'change_triage');
    await seedArtifact(d, 'approved_render');
    await forceState(d.engagementId, 'final_approval');
    expect((await seenNow(d)).rendersIssuedAt).not.toBe(seen.rendersIssuedAt);
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' }, seen)).toEqual({ kind: 'changed' });
  });

  it('a render replaced (the old hidden, a new one shown) re-stamps too; recorded but not shown does not', async () => {
    const d = await atFinalApproval('rr-replaced');
    const old = await seedArtifact(d, 'approved_render');
    const before = await rendersReadyAtText(d.engagementId);
    await seedArtifact(d, 'approved_render', { release: false });
    expect(await rendersReadyAtText(d.engagementId)).toBe(before);
    expect((await setArtifactClientVisibilityCore(d.ctx, { artifactId: old, visible: false })).ok).toBe(true);
    await seedArtifact(d, 'approved_render');
    expect(await rendersReadyAtText(d.engagementId)).not.toBe(before);
  });
});

describe('a render shown AFTER the client decided leaves the decision standing (owner decision)', () => {
  it.each([
    ['approve_design', 'approved'],
    ['request_design_changes', 'changes_requested'],
  ] as const)('after %s: no re-stamp, and the decision still counts', async (action, kind) => {
    const d = await atFinalApproval(`rr-after-${action}`);
    expect(await respondToDesignAndNotify(d.token, { action, note: 'x' }, await seenNow(d))).toMatchObject({ kind });
    const before = await rendersReadyAtText(d.engagementId);
    await seedArtifact(d, 'approved_render');
    expect(await rendersReadyAtText(d.engagementId)).toBe(before);
    expect(await decisionOnPage(d)).toBe(kind);
  });

  it('a stage the client is not asked at (shop_drawings) leaves the stamp alone', async () => {
    const d = await atFinalApproval('rr-other-stage');
    await forceState(d.engagementId, 'shop_drawings');
    const before = await rendersReadyAtText(d.engagementId);
    await seedArtifact(d, 'approved_render');
    expect(await rendersReadyAtText(d.engagementId)).toBe(before);
  });
});

describe('forced interleavings (R3): the database decides after the lock wait', () => {
  it('the delivery leaves the review while the render is being shown: no re-stamp', async () => {
    const d = await atFinalApproval('rr-race-state');
    const before = await rendersReadyAtText(d.engagementId);
    await showWhileHeld(d, `update public.design_engagements set state = 'shop_drawings' where id = '${d.engagementId}'`);
    expect(await rendersReadyAtText(d.engagementId)).toBe(before);
  });

  it('the client approves while the render is being shown: no re-stamp, the approval stands', async () => {
    const d = await atFinalApproval('rr-race-decision');
    const round = (await seenNow(d)).rendersIssuedAt;
    await showWhileHeld(
      d,
      `select public.app_delivery_respond_by_token('${d.hash}', 'approve_design', '${round}'::timestamptz, null, null, null, null)`,
    );
    expect((await seenNow(d)).rendersIssuedAt).toBe(round);
    expect(await decisionOnPage(d)).toBe('approved');
  });
});
