import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { recordRomAcknowledgementCore } from '@/lib/engagements/rom-acknowledgement';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import { recordOfflineApprovalCore } from '@/lib/engagements/offline-approval-core';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { issueRomCore } from '@/lib/engagements/rom-issue';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import type { GenerateFeeSchedulePayload, Trigger } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { hashShareToken } from '@/lib/share/token';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { clientActionsOf } from './round-b-fixture';

// Round B gate follow-ups, through the REAL paths on both sides:
//   * a design review pushed into round 2 by the client (request changes on the
//     portal) and the studio (designChangeRaised, then rendersReady re-stamps
//     renders_ready_at): at every step the studio's rule (client-review.ts, read
//     through the gate preview) and the portal's client_actions agree;
//   * R3: "Client approved offline" re-checks, under the delivery row lock, that
//     the client has not answered the same round meanwhile, and refuses
//     `client_review_answered` when they have. An answer to an EARLIER round
//     does not block it.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const FEE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

interface Seeded {
  ctx: OrgContext;
  engagementId: string;
  token: string;
  hash: string;
}

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function staffApprovals(engagementId: string, kind: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_events
      where engagement_id = '${engagementId}' and kind = '${kind}' and actor_channel = 'staff'`,
  );
  return Number(row.n);
}

/** A delivery with a live client link, driven to concept_review. */
async function seedConceptReview(): Promise<Seeded> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
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
  const run = async (trigger: Trigger, payload?: unknown) =>
    expect((await executeTransition(ctx, { engagementId, trigger, payload })).ok).toBe(true);
  await run('submitDesignFee', FEE);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await run('confirmAndPayDeposit');
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await run('spatialBaseReady');
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await run('optionsReady');
  const minted = await mintDeliveryLinkCore(ctx, engagementId);
  expect(minted.ok).toBe(true);
  const token = minted.data!;
  expect(await stateOf(engagementId)).toBe('concept_review');
  return { ctx, engagementId, token, hash: hashShareToken(token) };
}

/** The same, on to final_approval with every Gate-B guard met (ROM acked, gate_b paid). */
async function seedFinalApproval(): Promise<Seeded> {
  const seeded = await seedConceptReview();
  const { ctx, engagementId } = seeded;
  const run = async (trigger: Trigger) =>
    expect((await executeTransition(ctx, { engagementId, trigger })).ok).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await run('selectConcept');
  await run('confirmConcept');
  await recordArtifactCore(ctx, { engagementId, kind: 'approved_render', contentHash: 'hash-alpha' });
  await recordArtifactCore(ctx, { engagementId, kind: 'approved_render', contentHash: 'hash-beta' });
  await run('rendersReady');
  expect((await setEngagementRomCore(ctx, { engagementId, romLow: '500000', romHigh: '800000' })).ok).toBe(true);
  expect((await issueRomCore(ctx, { engagementId })).ok).toBe(true);
  expect((await recordRomAcknowledgementCore(ctx, { engagementId })).ok).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
  expect(await stateOf(engagementId)).toBe('final_approval');
  return seeded;
}

/** The studio rule and the portal, side by side. */
async function bothSides(seeded: Seeded) {
  const preview = await getEngagementGatePreview(seeded.ctx, seeded.engagementId);
  const actions = await clientActionsOf(seeded.hash);
  return {
    studioWaiting: preview.awaitingClientReview,
    studioDecision: preview.clientDecision?.kind ?? null,
    portalOffersDesign:
      actions.includes('approve_design') && actions.includes('request_design_changes'),
  };
}

describe('a design review pushed into round 2 (studio rule vs portal)', () => {
  it('agrees at every step: round 1, the change request, the revision, round 2, the approval', async () => {
    const seeded = await seedFinalApproval();
    const { ctx, engagementId, token } = seeded;

    // Round 1, unanswered: the studio waits, the portal asks.
    expect(await bothSides(seeded)).toEqual({
      studioWaiting: true,
      studioDecision: null,
      portalOffersDesign: true,
    });

    // The client asks for changes on the portal: round 1 is answered on both sides.
    expect(await recordDeliveryActionByToken(token, { action: 'request_design_changes' })).toEqual({
      ok: true,
    });
    expect(await bothSides(seeded)).toEqual({
      studioWaiting: false,
      studioDecision: 'design_change_request',
      portalOffersDesign: false,
    });

    // The studio revises: out of the review stage, nobody waits, nothing to answer.
    expect((await executeTransition(ctx, { engagementId, trigger: 'designChangeRaised' })).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await bothSides(seeded)).toEqual({
      studioWaiting: false,
      studioDecision: null,
      portalOffersDesign: false,
    });

    // The renders are issued again (renders_ready_at re-stamped): round 2 is open
    // on both sides, and round 1's change request answers nothing any more.
    expect((await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await bothSides(seeded)).toEqual({
      studioWaiting: true,
      studioDecision: null,
      portalOffersDesign: true,
    });

    // The client approves round 2.
    expect(await recordDeliveryActionByToken(token, { action: 'approve_design' })).toEqual({ ok: true });
    expect(await bothSides(seeded)).toEqual({
      studioWaiting: false,
      studioDecision: 'design_approval',
      portalOffersDesign: false,
    });
  });
});

describe('R3: Client approved offline after the client answered', () => {
  it('concept_review: a portal change request first refuses the offline approval, nothing moves', async () => {
    const seeded = await seedConceptReview();
    const { ctx, engagementId, token } = seeded;
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
    expect(await recordDeliveryActionByToken(token, { action: 'request_concept_changes' })).toEqual({
      ok: true,
    });

    const res = await recordOfflineApprovalCore(ctx, {
      engagementId,
      trigger: 'selectConcept',
      approval: { channel: 'phone' },
    });
    expect(res).toEqual({ ok: false, error: 'client_review_answered' });
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await staffApprovals(engagementId, 'concept_approval')).toBe(0);
  });

  it('final_approval: a portal decision in THIS round refuses it', async () => {
    const seeded = await seedFinalApproval();
    const { ctx, engagementId, token } = seeded;
    expect(await recordDeliveryActionByToken(token, { action: 'request_design_changes' })).toEqual({
      ok: true,
    });

    const res = await recordOfflineApprovalCore(ctx, {
      engagementId,
      trigger: 'approveDesign',
      approval: { channel: 'whatsapp' },
    });
    expect(res).toEqual({ ok: false, error: 'client_review_answered' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await staffApprovals(engagementId, 'design_approval')).toBe(0);
  });

  it("final_approval: an answer to an EARLIER round does not block round 2's offline approval", async () => {
    const seeded = await seedFinalApproval();
    const { ctx, engagementId, token } = seeded;
    expect(await recordDeliveryActionByToken(token, { action: 'request_design_changes' })).toEqual({
      ok: true,
    });
    expect((await executeTransition(ctx, { engagementId, trigger: 'designChangeRaised' })).ok).toBe(true);
    expect((await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok).toBe(true);

    const res = await recordOfflineApprovalCore(ctx, {
      engagementId,
      trigger: 'approveDesign',
      approval: { channel: 'in_person' },
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await staffApprovals(engagementId, 'design_approval')).toBe(1);
  });

  it("the studio's own Advance (no payload) is not re-checked: decision 4 keeps approval advisory", async () => {
    const seeded = await seedFinalApproval();
    const { ctx, engagementId, token } = seeded;
    expect(await recordDeliveryActionByToken(token, { action: 'request_design_changes' })).toEqual({
      ok: true,
    });
    expect((await executeTransition(ctx, { engagementId, trigger: 'approveDesign' })).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
  });
});
