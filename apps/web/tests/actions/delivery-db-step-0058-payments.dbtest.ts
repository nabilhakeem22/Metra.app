import { afterAll, describe, expect, it } from 'vitest';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { closeFixture, teardown } from './fixture';
import { forceState, seedFeeSchedule, seedRoundBDelivery, snapshotOf } from './round-b-fixture';
import { plantPayment } from './round-c-db-fixture';
import { setStudioDetails, STUDIO_DETAILS, STUDIO_PAYMENT_DETAILS } from './round-c-org-fixture';

// Round C, PR-C7: the owner's rule that the studio's payment details reach the
// client ONLY while a payment is due (fix round: F2, S2, F8). Due means a
// milestone with a remaining amount on a delivery that is still running, and
// the details must name a usable method.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

type Claim = { claimable_milestones: Array<{ milestone_kind: string }> };

async function paymentView(hash: string) {
  const snapshot = (await snapshotOf(hash))!;
  return {
    details: snapshot.payment_details,
    claimable: (snapshot.claim as Claim).claimable_milestones.map((m) => m.milestone_kind),
  };
}

describe('payment details only while a payment is due (owner decision)', () => {
  it('null with no fee schedule, present while any milestone is due, null once all are paid', async () => {
    const d = await seedRoundBDelivery(orgIds, 'pay-due');
    await setStudioDetails(d.orgId, STUDIO_DETAILS);
    expect((await paymentView(d.hash)).details).toBeNull();

    await seedFeeSchedule(d);
    expect((await paymentView(d.hash)).details).toEqual(STUDIO_PAYMENT_DETAILS);
    await plantPayment(d, 'deposit', '30000', 'now()');
    await plantPayment(d, 'gate_a', '20000', 'now()');
    await plantPayment(d, 'gate_b', '10000', 'now()');
    expect((await paymentView(d.hash)).details).toEqual(STUDIO_PAYMENT_DETAILS);
    await plantPayment(d, 'gate_b', '15000', 'now()');
    await plantPayment(d, 'balance', '25000', 'now()');
    expect(await paymentView(d.hash)).toEqual({ details: null, claimable: [] });
    // The contact numbers are not payment details: they stay.
    expect((await snapshotOf(d.hash))!.firm).toMatchObject({ phone: '+201012345678' });
  });

  it('a delivery that has ended offers neither the details nor a claim, matching the claim write (F2, S2)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'pay-ended');
    await setStudioDetails(d.orgId, STUDIO_DETAILS);
    await seedFeeSchedule(d);
    await forceState(d.engagementId, 'design_only_handoff');
    expect(await paymentView(d.hash)).toEqual({
      details: STUDIO_PAYMENT_DETAILS, claimable: ['deposit', 'gate_a', 'gate_b', 'balance'],
    });
    for (const ended of ['abandoned', 'closed_design_only', 'execution']) {
      await forceState(d.engagementId, ended);
      expect(await paymentView(d.hash), ended).toEqual({ details: null, claimable: [] });
      expect(await claimPaymentByToken(d.token, { milestoneKind: 'deposit' }), ended).toMatchObject({
        ok: false,
      });
    }
  });

  it('null unless a usable method is set: InstaPay, or a bank with an account number or IBAN (F8)', async () => {
    const cases: Array<[Record<string, string | null>, boolean]> = [
      [{ studio_phone: '01012345678' }, false],
      [{ bank_account_holder: 'Studio LLC' }, false],
      [{ bank_name: 'CIB' }, false],
      [{ bank_name: 'CIB', bank_account_holder: 'Studio LLC' }, false],
      [{ instapay_address: 'studio@instapay' }, true],
      [{ bank_name: 'CIB', bank_account_number: '100023456789' }, true],
      [{ bank_name: 'NBE', bank_iban: 'EG110003000100000000000000001' }, true],
    ];
    for (const [details, shown] of cases) {
      const d = await seedRoundBDelivery(orgIds, 'pay-usable');
      await setStudioDetails(d.orgId, details);
      await seedFeeSchedule(d);
      const view = await paymentView(d.hash);
      expect(view.details !== null, JSON.stringify(details)).toBe(shown);
    }
  });

  it("each delivery reads only its own studio's details (tenant isolation)", async () => {
    const a = await seedRoundBDelivery(orgIds, 'pay-tenant-a');
    const b = await seedRoundBDelivery(orgIds, 'pay-tenant-b');
    await setStudioDetails(a.orgId, STUDIO_DETAILS);
    await setStudioDetails(b.orgId, {
      studio_phone: '0225550000', bank_name: 'NBE', bank_iban: 'EG110003000100000000000000001',
    });
    await seedFeeSchedule(a);
    await seedFeeSchedule(b);
    expect((await paymentView(a.hash)).details).toEqual(STUDIO_PAYMENT_DETAILS);
    expect((await snapshotOf(b.hash))!.firm).toMatchObject({ phone: '0225550000', whatsapp: null });
    expect((await paymentView(b.hash)).details).toEqual({
      instapay: null, bank_name: 'NBE', bank_account_holder: null, bank_account_number: null,
      bank_iban: 'EG110003000100000000000000001',
    });
  });
});
