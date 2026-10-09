import { afterAll, describe, expect, it } from 'vitest';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { closeFixture, raw, teardown } from './fixture';
import { seedArtifact, seedFeeSchedule, seedRoundBDelivery, snapshotOf } from './round-b-fixture';
import { setStudioDetails, STUDIO_DETAILS } from './round-c-org-fixture';

// Round C, PR-C7: the new keys of app_delivery_by_token (AC 33). The payment
// details rule is pinned in delivery-db-step-0058-payments.dbtest.ts.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('the new snapshot keys (AC 33)', () => {
  it('are all present, null or [] where nothing applies', async () => {
    const d = await seedRoundBDelivery(orgIds, 'keys-empty');
    const snapshot = (await snapshotOf(d.hash))!;
    expect(snapshot.firm).toMatchObject({ phone: null, whatsapp: null });
    expect(snapshot).toMatchObject({
      payment_details: null,
      expected_on: null,
      design_decision: null,
      handover_acknowledged_at: null,
      rom_acknowledged_at: null,
      timeline: [],
    });
  });

  it('carries the studio contact, claimed_at on the pending claim, and documents[].media', async () => {
    const d = await seedRoundBDelivery(orgIds, 'keys-set');
    await setStudioDetails(d.orgId, STUDIO_DETAILS);
    await seedFeeSchedule(d);
    await seedArtifact(d, 'approved_render');
    expect(await claimPaymentByToken(d.token, { milestoneKind: 'deposit' })).toEqual({ ok: true });
    const [claim] = await raw.query<{ at: string }>(
      `select to_json(created_at)#>>'{}' as at from public.client_payment_claims where engagement_id = '${d.engagementId}'`,
    );
    const snapshot = (await snapshotOf(d.hash))!;
    expect(snapshot.firm).toMatchObject({ phone: '+201012345678', whatsapp: '01012345678' });
    const milestones = (snapshot.claim as { claimable_milestones: Array<{ milestone_kind: string; claimed_at: string | null }> })
      .claimable_milestones;
    expect(milestones.map((m) => [m.milestone_kind, m.claimed_at])).toEqual([
      ['deposit', claim.at],
      ['gate_a', null],
      ['gate_b', null],
      ['balance', null],
    ]);
    expect((snapshot.documents as Array<{ media: string }>).map((doc) => doc.media)).toEqual(['image']);
  });
});
