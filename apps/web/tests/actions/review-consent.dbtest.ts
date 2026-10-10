import { afterAll, describe, expect, it } from 'vitest';
import { acknowledgeSeenBudgetAndNotify } from '@/lib/engagements/client-acts/budget-acts';
import { respondToConceptAndNotify } from '@/lib/engagements/client-acts/concept-acts';
import {
  approveDesignWithBudgetAndNotify,
  respondToDesignAndNotify,
} from '@/lib/engagements/client-acts/design-acts';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { bandSeenOf, reviewSeenOf } from '@/lib/engagements/review-seen';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedArtifact, seedRoundBDelivery, stampRenders, type RoundBDelivery } from './round-b-fixture';
import { plantTransition } from './round-c-db-fixture';

// Fix round F1/F2 (S1), F6, F7 through the real write, read and notifier: an
// approval or acknowledgement is written only about what the client SAW, and a
// repeat tap answers the decision on file whatever the studio did meanwhile.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const shown = async (d: RoundBDelivery) => reviewSeenOf((await deliveryOrNull(d.token))!);

async function clientKinds(d: RoundBDelivery): Promise<string[]> {
  const rows = await raw.query<{ kind: string }>(
    `select kind from public.engagement_events where engagement_id = '${d.engagementId}' and actor_channel = 'client' order by kind`,
  );
  return rows.map((row) => row.kind);
}

async function issueBand(d: RoundBDelivery, low: number, high: number): Promise<void> {
  await raw.query(
    `update public.design_engagements set rom_low = ${low}, rom_high = ${high}, rom_issued_at = clock_timestamp()
      where id = '${d.engagementId}'`,
  );
}

async function atFinalApproval(suffix: string): Promise<RoundBDelivery> {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await plantTransition(d, 'design_3d', 'final_approval', `now() - interval '1 hour'`);
  await forceState(d.engagementId, 'final_approval');
  await stampRenders(d.engagementId, `now() - interval '1 hour'`);
  await issueBand(d, 900000, 1200000);
  return d;
}

describe('F1: the band acknowledged is the band the client saw', () => {
  it('a band re-issued while the dialog was open: changed, neither approval nor acknowledgement', async () => {
    const d = await atFinalApproval('consent-rebanded');
    const seen = await shown(d);
    await issueBand(d, 1500000, 2000000);
    expect(await approveDesignWithBudgetAndNotify(d.token, {}, seen)).toEqual({ kind: 'changed' });
    expect(await clientKinds(d)).toEqual([]);
  });

  it('a stale tab after the delivery moved on and a new band was issued acknowledges nothing', async () => {
    const d = await atFinalApproval('consent-stale');
    const seen = await shown(d);
    expect(await approveDesignWithBudgetAndNotify(d.token, {}, seen)).toMatchObject({ kind: 'approved', budgetAcknowledged: true });
    await forceState(d.engagementId, 'boq');
    await issueBand(d, 4000000, 5000000);
    expect(await approveDesignWithBudgetAndNotify(d.token, {}, seen)).toEqual({ kind: 'changed' });
    const rows = await raw.query<{ range_low: string }>(
      `select range_low::text from public.engagement_events where engagement_id = '${d.engagementId}' and kind = 'rom_acknowledgement'`,
    );
    expect(rows.map((row) => row.range_low)).toEqual(['900000.0000']);
  });

  it('the same band, still there: approval and acknowledgement in one go', async () => {
    const d = await atFinalApproval('consent-same');
    expect(await approveDesignWithBudgetAndNotify(d.token, {}, await shown(d))).toMatchObject({ budgetAcknowledged: true });
    expect(await clientKinds(d)).toEqual(['design_approval', 'rom_acknowledgement']);
  });

  it('the budget card: another band writes nothing; the band shown is acknowledged', async () => {
    const d = await atFinalApproval('consent-card');
    const band = bandSeenOf((await deliveryOrNull(d.token))!)!;
    await issueBand(d, 1500000, 2000000);
    expect(await acknowledgeSeenBudgetAndNotify(d.token, {}, band)).toEqual({ kind: 'changed' });
    expect(await clientKinds(d)).toEqual([]);
    const now = bandSeenOf((await deliveryOrNull(d.token))!)!;
    expect(await acknowledgeSeenBudgetAndNotify(d.token, {}, now)).toEqual({ kind: 'acknowledged', studioNotified: true });
  });
});

describe('F2: a design decision answers the render round the client saw', () => {
  it('renders re-issued (a new move into final approval) or a new render shared: changed, nothing written', async () => {
    const d = await atFinalApproval('consent-round');
    const seen = await shown(d);
    await plantTransition(d, 'design_3d', 'final_approval', 'now()');
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' }, seen)).toEqual({ kind: 'changed' });
    const reseen = await shown(d);
    await seedArtifact(d, 'approved_render');
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' }, reseen)).toEqual({ kind: 'changed' });
    expect(await clientKinds(d)).toEqual([]);
  });
});

describe('F6, F7: repeat taps answer what is on file', () => {
  it('F6: a concept tap after the studio moved on answers the saved approval', async () => {
    const d = await seedRoundBDelivery(orgIds, 'consent-concept');
    await forceState(d.engagementId, 'concept_review');
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_concept' })).toEqual({ ok: true });
    await forceState(d.engagementId, 'negotiation');
    expect(await respondToConceptAndNotify(d.token, { action: 'request_concept_changes', note: 'x' })).toMatchObject({
      kind: 'approved',
    });
  });

  it('F7: a budget tap after the delivery closed answers the acknowledgement on file', async () => {
    const d = await atFinalApproval('consent-budget-closed');
    const band = bandSeenOf((await deliveryOrNull(d.token))!)!;
    expect(await acknowledgeSeenBudgetAndNotify(d.token, {}, band)).toMatchObject({ kind: 'acknowledged' });
    await forceState(d.engagementId, 'closed_design_only');
    expect(await acknowledgeSeenBudgetAndNotify(d.token, {}, band)).toEqual({ kind: 'acknowledged', studioNotified: true });
  });
});
