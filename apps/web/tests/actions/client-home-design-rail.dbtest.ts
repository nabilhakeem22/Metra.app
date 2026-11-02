import { afterAll, describe, expect, it } from 'vitest';
import { executeTransition } from '@/lib/engagements/executor';
import { confirmPaymentClaimCore } from '@/lib/engagements/payment-claims';
import { recordPaymentCore } from '@/lib/engagements/payments';
import type { PublicDelivery } from '@/lib/engagements/public';
import { buildPhaseView } from '@/lib/flow/build-view';
import { awaitedDesignFee, locateDesignForClient } from '@/lib/flow/locate/design-client';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { claimDesignWithCode, requestCode, setClientEmail } from './client-home-fixture';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';
import { respondAsSeen } from './respond-as-seen';
import { forceState, seedFeeSchedule, seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';

// The design tab's card reads the real read (H8, AC15, AC16): where the rail puts
// the delivery and the instalment it waits on, on `app_delivery_by_token`'s own
// rows through `getDeliveryByToken`. No payload change: the same keys as before.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const DELIVERY_KEYS = [
  'client',
  'clientActions',
  'conceptChoice',
  'conceptDecision',
  'conceptOptions',
  'createdAt',
  'designDecision',
  'designFeeTotal',
  'documents',
  'entryPhase',
  'expectedOn',
  'firm',
  'handoverAcknowledgedAt',
  'hero',
  'id',
  'lastUpdateAt',
  'milestone',
  'number',
  'offPlan',
  'paymentClaim',
  'paymentDetails',
  'paymentSchedule',
  'receipts',
  'receiptsTruncated',
  'rendersIssuedAt',
  'rom',
  'romAcknowledgedAt',
  'shareExpiresAt',
  'stageKey',
  'timeline',
  'titleAr',
  'titleEn',
];

/** A delivery with the 4-instalment amount schedule, on the proposal, with the client's address on file. */
async function seedDesignDelivery(suffix: string): Promise<RoundBDelivery> {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await seedFeeSchedule(d);
  const [row] = await raw.query<{ client_id: string }>(`select client_id from public.design_engagements where id = '${d.engagementId}'`);
  await setClientEmail(d.orgId, row.client_id, 'client@example.org');
  return d;
}

async function read(d: RoundBDelivery): Promise<PublicDelivery> {
  const delivery = await deliveryOrNull(d.token);
  if (!delivery) throw new Error('the link read nothing');
  expect(Object.keys(delivery).sort()).toEqual(DELIVERY_KEYS);
  buildPhaseView(DESIGN_PHASE, locateDesignForClient(delivery), 'client');
  return delivery;
}

async function pendingClaimId(d: RoundBDelivery, kind: string): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `select id from public.client_payment_claims where engagement_id = '${d.engagementId}' and milestone_kind = '${kind}' and status = 'pending'`,
  );
  return row.id;
}

describe('the design rail on the real read', () => {
  it('the deposit: due, claimed with a code, then confirmed by the studio', async () => {
    const d = await seedDesignDelivery('h8-deposit');
    const due = await read(d);
    expect(locateDesignForClient(due)).toEqual({ step: 'proposal', whoseMove: 'client', status: 'active' });
    expect(awaitedDesignFee(due)).toBe('deposit');

    const asked = await requestCode(d.hash, 'claim_design_payment', 'deposit');
    expect(asked.answer.status).toBe('ok');
    expect((await claimDesignWithCode(d.hash, 'deposit', asked.code)).code).toBe('ok');
    const claimed = await read(d);
    expect(locateDesignForClient(claimed).whoseMove).toBe('studio');
    expect(awaitedDesignFee(claimed)).toBeNull();

    const confirmed = await confirmPaymentClaimCore(d.ctx, { claimId: await pendingClaimId(d, 'deposit'), amount: '30000' });
    expect(confirmed.ok).toBe(true);
    const paid = await read(d);
    expect(locateDesignForClient(paid).whoseMove).toBe('studio');
    expect(awaitedDesignFee(paid)).toBeNull();
  });

  it('the concept review: the open act holds the move with Gate A paid; after the answer, Gate A due holds it', async () => {
    const paidFirst = await seedDesignDelivery('h8-gate-a-paid');
    await forceState(paidFirst.engagementId, 'concept_review');
    await recordPaymentCore(paidFirst.ctx, { engagementId: paidFirst.engagementId, kind: 'gate_a', amount: '20000' });
    const open = await read(paidFirst);
    expect(open.clientActions).toContain('approve_concept');
    expect(open.hero.kind).toBe('action');
    expect(locateDesignForClient(open)).toEqual({ step: 'concept', whoseMove: 'client', status: 'active' });
    expect(awaitedDesignFee(open)).toBeNull();

    const dueAfter = await seedDesignDelivery('h8-gate-a-due');
    await forceState(dueAfter.engagementId, 'concept_review');
    expect(await respondAsSeen(dueAfter.token, { action: 'approve_concept' })).toMatchObject({ ok: true });
    const answered = await read(dueAfter);
    expect(answered.hero.kind).toBe('inProgress');
    expect(locateDesignForClient(answered)).toEqual({ step: 'concept', whoseMove: 'client', status: 'active' });
    expect(awaitedDesignFee(answered)).toBe('gate_a');
  });

  it('a finished, a closed and a continued delivery: no step in hand and no fee, the balance still due included', async () => {
    const d = await seedDesignDelivery('h8-ends');
    await forceState(d.engagementId, 'closed_design_only');
    const finished = await read(d);
    expect(locateDesignForClient(finished)).toEqual({ step: 'handover', whoseMove: null, status: 'complete' });
    expect(awaitedDesignFee(finished)).toBeNull();

    await forceState(d.engagementId, 'execution');
    const continued = await read(d);
    expect(locateDesignForClient(continued)).toEqual({ step: 'handover', whoseMove: null, status: 'complete' });
    expect(awaitedDesignFee(continued)).toBeNull();
    expect(buildPhaseView(DESIGN_PHASE, locateDesignForClient(continued), 'client').steps.every((step) => step.status === 'done')).toBe(true);

    await forceState(d.engagementId, 'abandoned');
    const abandoned = await read(d);
    expect(locateDesignForClient(abandoned)).toEqual({ step: null, whoseMove: null, status: 'closed' });
    expect(awaitedDesignFee(abandoned)).toBeNull();
  });

  it('a delivery really continued from design only to execution stays complete on its one link', async () => {
    const d = await seedDesignDelivery('h8-continued');
    await recordPaymentCore(d.ctx, { engagementId: d.engagementId, kind: 'balance', amount: '25000' });
    await forceState(d.engagementId, 'closed_design_only');
    expect(await executeTransition(d.ctx, { engagementId: d.engagementId, trigger: 'continueToExecution' })).toMatchObject({ ok: true });
    const continued = await read(d);
    expect(continued.stageKey).toBe('construction');
    expect(locateDesignForClient(continued)).toEqual({ step: 'handover', whoseMove: null, status: 'complete' });
    expect(buildPhaseView(DESIGN_PHASE, locateDesignForClient(continued), 'client').currentStep).toBeNull();
  });
});
