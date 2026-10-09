import { afterAll, describe, expect, it } from 'vitest';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { closeFixture, raw, teardown } from './fixture';
import { seedArtifact, seedFeeSchedule, seedRoundBDelivery, snapshotOf } from './round-b-fixture';
import { plantPayment, setStudioDetails } from './round-c-db-fixture';

// Round C, PR-C7: the new keys of app_delivery_by_token (AC 33) and the
// owner's rule that the studio's payment details reach the client ONLY while a
// payment is due.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const DETAILS = {
  studio_phone: '+201012345678',
  studio_whatsapp: '01012345678',
  instapay_address: 'studio@instapay',
  bank_name: 'CIB',
  bank_account_holder: 'Studio LLC',
  bank_account_number: '100023456789',
  bank_iban: 'EG380019000500000000263180002',
};

const PAYMENT_DETAILS = {
  instapay: 'studio@instapay',
  bank_name: 'CIB',
  bank_account_holder: 'Studio LLC',
  bank_account_number: '100023456789',
  bank_iban: 'EG380019000500000000263180002',
};

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
    await setStudioDetails(d.orgId, DETAILS);
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

describe('payment details only while a payment is due (owner decision)', () => {
  it('null with no fee schedule, present while any milestone is due, null once all are paid', async () => {
    const d = await seedRoundBDelivery(orgIds, 'pay-due');
    await setStudioDetails(d.orgId, DETAILS);
    expect((await snapshotOf(d.hash))!.payment_details).toBeNull();

    await seedFeeSchedule(d);
    expect((await snapshotOf(d.hash))!.payment_details).toEqual(PAYMENT_DETAILS);
    await plantPayment(d, 'deposit', '30000', 'now()');
    await plantPayment(d, 'gate_a', '20000', 'now()');
    await plantPayment(d, 'gate_b', '10000', 'now()');
    expect((await snapshotOf(d.hash))!.payment_details).toEqual(PAYMENT_DETAILS);
    await plantPayment(d, 'gate_b', '15000', 'now()');
    await plantPayment(d, 'balance', '25000', 'now()');
    const settled = (await snapshotOf(d.hash))!;
    expect((settled.claim as { claimable_milestones: unknown[] }).claimable_milestones).toEqual([]);
    expect(settled.payment_details).toBeNull();
    // The contact numbers are not payment details: they stay.
    expect(settled.firm).toMatchObject({ phone: '+201012345678' });
  });

  it('null while due when the studio set none of the five', async () => {
    const d = await seedRoundBDelivery(orgIds, 'pay-none');
    await setStudioDetails(d.orgId, { studio_phone: '01012345678' });
    await seedFeeSchedule(d);
    expect((await snapshotOf(d.hash))!.payment_details).toBeNull();
  });

  it("each delivery reads only its own studio's details (tenant isolation)", async () => {
    const a = await seedRoundBDelivery(orgIds, 'pay-tenant-a');
    const b = await seedRoundBDelivery(orgIds, 'pay-tenant-b');
    await setStudioDetails(a.orgId, DETAILS);
    await setStudioDetails(b.orgId, { studio_phone: '0225550000', bank_name: 'NBE', bank_iban: 'EG110003000100000000000000001' });
    await seedFeeSchedule(a);
    await seedFeeSchedule(b);
    const snapshotA = (await snapshotOf(a.hash))!;
    const snapshotB = (await snapshotOf(b.hash))!;
    expect(snapshotA.payment_details).toEqual(PAYMENT_DETAILS);
    expect(snapshotB.firm).toMatchObject({ phone: '0225550000', whatsapp: null });
    expect(snapshotB.payment_details).toEqual({
      instapay: null, bank_name: 'NBE', bank_account_holder: null, bank_account_number: null,
      bank_iban: 'EG110003000100000000000000001',
    });
  });
});
