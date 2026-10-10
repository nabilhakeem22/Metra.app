import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { getDeliveryLogoByToken } from '@/lib/engagements/public-logo';
import { DESIGN_STATES } from '@/lib/engagements/states';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedArtifact, seedFeeSchedule, seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';
import { plantEvent, plantPayment, plantTransition } from './round-c-db-fixture';
import { setStudioDetails, STUDIO_DETAILS } from './round-c-org-fixture';

// Round C, PR-C9 (task 40 to 43) through the REAL read: app_delivery_by_token's
// new keys as the client page receives them. Studio contact, payment
// instructions only while a payment is due, the claim's date, the dated
// timeline in client words; and the logo's location for the logo route.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Give the org a logo file named `name`; returns the file id. */
async function setLogo(d: RoundBDelivery, name: string): Promise<string> {
  const fileId = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, bucket, object_key, original_name)
     values ('${fileId}', '${d.orgId}', 'organization', '${d.orgId}', 'metra-files', '${d.orgId}/logo/${fileId}', '${name}')`,
  );
  await raw.query(`update public.organizations set logo_file_id = '${fileId}' where id = '${d.orgId}'`);
  return fileId;
}

describe('the studio on the client page', () => {
  it('contact numbers, a logo flag without its id, and the logo location for the route (AC 45, 46)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c9-studio');
    await setStudioDetails(d.orgId, STUDIO_DETAILS);
    const logoId = await setLogo(d, 'Logo.PNG');
    const delivery = (await deliveryOrNull(d.token))!;
    expect(delivery.firm).toMatchObject({ hasLogo: true, phone: '+201012345678', whatsappDigits: '201012345678' });
    expect(JSON.stringify(delivery)).not.toContain(logoId);
    expect(await getDeliveryLogoByToken(d.token)).toEqual({ bucket: 'metra-files', objectKey: `${d.orgId}/logo/${logoId}` });

    await setLogo(d, 'logo.pdf');
    expect(await getDeliveryLogoByToken(d.token)).toBeNull();
    await raw.query(`update public.design_engagements set share_expires_at = now() - interval '1 minute' where id = '${d.engagementId}'`);
    expect(await getDeliveryLogoByToken(d.token)).toBeNull();
    expect(await getDeliveryLogoByToken('not-a-real-token')).toBeNull();
  });
});

describe('payment instructions and the claim date (AC 47, 48)', () => {
  it('present while a milestone is due, dated once claimed, gone when everything is paid', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c9-pay');
    await setStudioDetails(d.orgId, STUDIO_DETAILS);
    expect((await deliveryOrNull(d.token))!.paymentDetails).toBeNull();
    await seedFeeSchedule(d);
    expect((await deliveryOrNull(d.token))!.paymentDetails).toEqual({
      instapay: 'studio@instapay',
      bankName: 'CIB',
      bankAccountHolder: 'Studio LLC',
      bankAccountNumber: '100023456789',
      bankIban: 'EG380019000500000000263180002',
    });

    expect(await claimPaymentByToken(d.token, { milestoneKind: 'deposit' })).toEqual({ ok: true });
    const claimed = (await deliveryOrNull(d.token))!.paymentClaim!.claimableMilestones;
    expect(claimed.find((m) => m.milestoneKind === 'deposit')).toMatchObject({ hasPendingClaim: true, claimedAt: expect.any(String) });
    expect(claimed.find((m) => m.milestoneKind === 'gate_a')).toMatchObject({ hasPendingClaim: false, claimedAt: null });

    for (const [kind, amount] of [['deposit', '30000'], ['gate_a', '20000'], ['gate_b', '25000'], ['balance', '25000']]) {
      await plantPayment(d, kind!, amount!, `now() - interval '1 day'`);
    }
    const settled = (await deliveryOrNull(d.token))!;
    expect(settled.paymentDetails).toBeNull();
    // AC 48: the receipts come from the payments recorded, as scale-4 amounts.
    expect(settled.timeline.filter((entry) => entry.type === 'payment').map((entry) => entry.type === 'payment' && entry.amount)).toEqual(
      expect.arrayContaining(['30000.0000', '20000.0000', '25000.0000']),
    );
  });
});

describe('the dated timeline in client words (AC 49, 50)', () => {
  it('stages as stage keys, decisions as words (studio-recorded marked), never a raw key', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c9-timeline');
    await plantTransition(d, 'created', 'concept_review', `now() - interval '3 days'`);
    const option = await seedArtifact(d, 'concept_option');
    await plantEvent(d, { kind: 'concept_approval', chosenArtifactId: option, chosenPosition: 2, at: `now() - interval '2 days'` });
    await plantTransition(d, 'concept_review', 'design_3d', `now() - interval '2 days'`);
    await plantEvent(d, { kind: 'design_approval', channel: 'staff', evidence: 'Signed sheet', at: `now() - interval '1 day'` });
    await plantTransition(d, 'final_approval', 'closed_design_only', `now() - interval '1 hour'`);
    await forceState(d.engagementId, 'closed_design_only');

    const delivery = (await deliveryOrNull(d.token))!;
    expect(delivery.timeline.map((entry) => (entry.type === 'stage' ? entry.stageKey : entry.type === 'decision' ? entry.decision : entry.kind))).toEqual([
      'delivered',
      'design_approved',
      'visuals',
      'concept_chosen',
      'conceptReview',
    ]);
    const studioRecorded = delivery.timeline[1];
    expect(studioRecorded).toMatchObject({ type: 'decision', byStudio: true });
    expect(delivery.timeline[3]).toMatchObject({ letter: 'B', byStudio: false });
    // The newest dated thing: here the concept file shared just now, newer than any entry.
    expect(delivery.lastUpdateAt).toBe(delivery.documents[0]!.sharedAt && new Date(delivery.documents[0]!.sharedAt).toISOString());
    const json = JSON.stringify(delivery);
    for (const word of [...DESIGN_STATES, 'concept_approval', 'design_approval', 'by_studio']) {
      expect(json, word).not.toContain(`"${word}"`);
    }
  });
});
