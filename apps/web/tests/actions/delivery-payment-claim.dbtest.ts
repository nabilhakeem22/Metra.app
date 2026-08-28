import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import {
  confirmPaymentClaimCore,
  dismissPaymentClaimCore,
} from '@/lib/engagements/payment-claims';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementPaymentClaims } from '@/lib/engagements/queries';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A full 4-milestone AMOUNT split summing to the design fee. deposit 30k, gate_a
// 20k, gate_b 25k, balance 25k — so a "settled" and a "non-next unsettled" milestone
// are both reachable.
const FULL_SCHEDULE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '25000' },
    { kind: 'balance', basis: 'amount', value: '25000' },
  ],
};

// A PERCENT-basis split (same effective amounts) — proves the SDF's remaining-due
// math computes round(design_fee * pct / 100, 4) − cleared, not just amount-basis.
const PERCENT_SCHEDULE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'percent', value: '30' },
    { kind: 'gate_a', basis: 'percent', value: '20' },
    { kind: 'gate_b', basis: 'percent', value: '25' },
    { kind: 'balance', basis: 'percent', value: '25' },
  ],
};

/** Seed org + client + project + ONE engagement WITH a fee schedule + minted link. */
async function seedClaimDelivery(
  suffix: string,
  schedule: GenerateFeeSchedulePayload = FULL_SCHEDULE,
): Promise<{
  ctx: OrgContext;
  engagementId: string;
  token: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: `Acme ${suffix}` });
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
  });
  const engagementId = (created as { data?: string }).data!;
  await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: schedule,
  });
  const minted = await mintDeliveryLinkCore(ctx, engagementId);
  return { ctx, engagementId, token: minted.data! };
}

async function forceState(engagementId: string, state: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${engagementId}'`,
  );
}

async function claimRows(engagementId: string) {
  return raw.query<{
    id: string;
    milestone_kind: string;
    claimed_amount: string;
    status: string;
    actor_name: string | null;
    actor_ip: string | null;
    actor_user_agent: string | null;
    confirmed_payment_event_id: string | null;
    resolved_by: string | null;
  }>(
    `select id, milestone_kind, claimed_amount, status, actor_name, actor_ip,
            actor_user_agent, confirmed_payment_event_id, resolved_by
       from public.client_payment_claims
      where engagement_id = '${engagementId}'
      order by created_at`,
  );
}

async function paymentRows(engagementId: string) {
  return raw.query<{
    id: string;
    kind: string;
    amount: string;
    recorded_by: string;
    idempotency_key: string | null;
  }>(
    `select id, kind, amount, recorded_by, idempotency_key
       from public.payment_events
      where engagement_id = '${engagementId}'
      order by created_at`,
  );
}

describe('app_delivery_claim_payment_by_token — happy path + amount lock', () => {
  it('claims the deposit: ok, ONE pending row, amount = remaining due, actor stored', async () => {
    const { engagementId, token } = await seedClaimDelivery('claim-ok');

    const res = await claimPaymentByToken(token, {
      milestoneKind: 'deposit',
      actorName: 'Client Sam',
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    });
    expect(res).toEqual({ ok: true });

    const rows = await claimRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].milestone_kind).toBe('deposit');
    expect(rows[0].status).toBe('pending');
    // Amount is locked server-side to the full remaining deposit due (30000).
    expect(rows[0].claimed_amount).toBe('30000.0000');
    expect(rows[0].actor_name).toBe('Client Sam');
    expect(rows[0].actor_ip).toBe('1.2.3.4');
    expect(rows[0].actor_user_agent).toBe('Mozilla/5.0');
  });

  it('a second identical claim while pending returns already, adds no second row', async () => {
    const { engagementId, token } = await seedClaimDelivery('claim-already');
    expect(await claimPaymentByToken(token, { milestoneKind: 'deposit' })).toEqual({
      ok: true,
    });
    expect(await claimPaymentByToken(token, { milestoneKind: 'deposit' })).toEqual({
      ok: true,
      code: 'already',
    });
    expect(await claimRows(engagementId)).toHaveLength(1);
  });

  it('a NON-next but unsettled milestone (balance) is claimable — any-unsettled allowed', async () => {
    const { engagementId, token } = await seedClaimDelivery('claim-nonnext');
    // Claim the final `balance` milestone without settling deposit/gate_a first.
    const res = await claimPaymentByToken(token, { milestoneKind: 'balance' });
    expect(res).toEqual({ ok: true });
    const rows = await claimRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].milestone_kind).toBe('balance');
    expect(rows[0].claimed_amount).toBe('25000.0000');
  });

  it('PERCENT-basis milestone with a partial prior payment locks amount to round(fee*pct/100,4) - cleared', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery(
      'claim-percent',
      PERCENT_SCHEDULE,
    );
    // deposit due = round(100000 * 30 / 100, 4) = 30000; pay 10000 first.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '10000',
    });
    const res = await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    expect(res).toEqual({ ok: true });
    const [row] = await claimRows(engagementId);
    // 30000 (percent-derived due) − 10000 (cleared) = 20000 remaining.
    expect(row.claimed_amount).toBe('20000.0000');
  });
});

describe('app_delivery_claim_payment_by_token — wrong state / invalid / expired / terminal', () => {
  it('claiming a SETTLED milestone (remaining <= 0) returns wrong_state, writes nothing', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('claim-settled');
    // Fully pay the deposit first, so its remaining due is 0.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
    });
    const res = await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    expect(res).toEqual({ ok: false, error: 'wrong_state' });
    expect(await claimRows(engagementId)).toHaveLength(0);
  });

  it('an unknown milestone string returns wrong_state (valid token), writes nothing', async () => {
    const { engagementId, token } = await seedClaimDelivery('claim-badkind');
    // Valid token, unavailable milestone -> wrong_state (NOT token_invalid, which is
    // reserved for a token-not-found and shows the "link no longer available" message).
    const res = await claimPaymentByToken(token, { milestoneKind: 'not_a_kind' });
    expect(res).toEqual({ ok: false, error: 'wrong_state' });
    expect(await claimRows(engagementId)).toHaveLength(0);
  });

  it('a terminal delivery returns not_active, writes nothing', async () => {
    const { engagementId, token } = await seedClaimDelivery('claim-terminal');
    await forceState(engagementId, 'abandoned');
    const res = await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    expect(res).toEqual({ ok: false, error: 'not_active' });
    expect(await claimRows(engagementId)).toHaveLength(0);
  });

  it('an expired link returns token_expired, writes nothing', async () => {
    const { engagementId, token } = await seedClaimDelivery('claim-expired');
    await raw.query(
      `update public.design_engagements
         set share_expires_at = now() - interval '1 day'
       where id = '${engagementId}'`,
    );
    const res = await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    expect(res).toEqual({ ok: false, error: 'token_expired' });
    expect(await claimRows(engagementId)).toHaveLength(0);
  });

  it('an unknown token hash returns token_invalid', async () => {
    const res = await claimPaymentByToken('never-minted', { milestoneKind: 'deposit' });
    expect(res).toEqual({ ok: false, error: 'token_invalid' });
  });
});

describe('client payment claim — cost-blind by construction (AC4)', () => {
  it('neither the read SDF nor the claim SDF references any cost/margin column', async () => {
    const rows = await raw.query<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc
        where proname in ('app_delivery_by_token', 'app_delivery_claim_payment_by_token')`,
    );
    expect(rows.length).toBe(2);
    const FORBIDDEN = /unit_cost|line_cost|total_cost|margin|supervision|build_cost/;
    for (const row of rows) {
      expect(FORBIDDEN.test(row.prosrc)).toBe(false);
    }
  });
});

describe('client payment claim — org isolation (AC5)', () => {
  it("org B cannot read or confirm org A's claim", async () => {
    const a = await seedClaimDelivery('iso-a');
    await claimPaymentByToken(a.token, { milestoneKind: 'deposit' });
    const [claimA] = await claimRows(a.engagementId);

    const { orgId: orgB, ownerIds: ownersB } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownersB[0], 'owner');

    // B reading A's engagement claims -> empty (RLS-scoped).
    expect(await getEngagementPaymentClaims(ctxB, a.engagementId)).toEqual([]);

    // B confirming A's claim -> claim_not_found (RLS-filtered to empty).
    const res = await confirmPaymentClaimCore(ctxB, {
      claimId: claimA.id,
      amount: '30000',
    });
    expect(res).toEqual({ ok: false, error: 'claim_not_found' });

    // A's claim is untouched (still pending, no payment).
    const [after] = await claimRows(a.engagementId);
    expect(after.status).toBe('pending');
    expect(await paymentRows(a.engagementId)).toHaveLength(0);
  });
});

describe('client payment claim — firm is never blocked by a pending claim (AC6)', () => {
  it('with a pending claim present, recordPayment still records + a legal transition still fires', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('never-blocked');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });

    // The firm records the real deposit payment directly — no new guard blocks it.
    const pay = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'deposit',
      amount: '30000',
    });
    expect(pay.ok).toBe(true);

    // And a legal state transition (confirmAndPayDeposit) still fires.
    const advance = await executeTransition(ctx, {
      engagementId,
      trigger: 'confirmAndPayDeposit',
    });
    expect(advance.ok).toBe(true);
  });
});

describe('confirmPaymentClaimCore (AC7)', () => {
  it('a claim on an engagement that went terminal cannot record money', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-terminal');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);
    // The engagement is abandoned AFTER the claim was made while active.
    await forceState(engagementId, 'abandoned');

    const res = await confirmPaymentClaimCore(ctx, {
      claimId: claim.id,
      amount: '30000',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_active' });
    // No money recorded, and the claim stays pending (the whole tx rolled back).
    expect(await paymentRows(engagementId)).toHaveLength(0);
    expect((await claimRows(engagementId))[0].status).toBe('pending');
  });

  it('writes ONE payment row keyed by the claim id, flips claim to confirmed; second confirm is already', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);

    const first = await confirmPaymentClaimCore(ctx, {
      claimId: claim.id,
      amount: '30000',
    });
    expect(first.ok).toBe(true);
    const paymentId = (first as { data?: string }).data!;

    const payments = await paymentRows(engagementId);
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(paymentId);
    expect(payments[0].kind).toBe('deposit');
    expect(payments[0].recorded_by).toBe(ctx.userId);
    expect(payments[0].idempotency_key).toBe(claim.id);

    const [confirmed] = await claimRows(engagementId);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmed_payment_event_id).toBe(paymentId);
    expect(confirmed.resolved_by).toBe(ctx.userId);

    // Second confirm -> idempotent already, no second payment row.
    const second = await confirmPaymentClaimCore(ctx, {
      claimId: claim.id,
      amount: '30000',
    });
    expect(second.ok).toBe(true);
    expect((second as { already?: boolean }).already).toBe(true);
    expect(await paymentRows(engagementId)).toHaveLength(1);
  });

  it('the studio may edit the amount at confirm time', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-edit');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);
    // Client claimed 30000; the studio corrects it to 27500.5.
    const res = await confirmPaymentClaimCore(ctx, {
      claimId: claim.id,
      amount: '27500.5',
    });
    expect(res.ok).toBe(true);
    const [payment] = await paymentRows(engagementId);
    expect(payment.amount).toBe('27500.5000');
  });
});

describe('dismissPaymentClaimCore (AC8)', () => {
  it('dismisses without a payment row; a re-submitted client claim is then ok', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('dismiss');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);

    const res = await dismissPaymentClaimCore(ctx, { claimId: claim.id });
    expect(res.ok).toBe(true);

    const rows = await claimRows(engagementId);
    expect(rows.find((r) => r.id === claim.id)!.status).toBe('dismissed');
    expect(await paymentRows(engagementId)).toHaveLength(0);

    // The partial-unique slot is freed -> the client may re-submit a new pending claim.
    const resubmit = await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    expect(resubmit).toEqual({ ok: true });
    const openClaims = (await claimRows(engagementId)).filter(
      (r) => r.status === 'pending',
    );
    expect(openClaims).toHaveLength(1);

    // A dismissed claim can no longer be confirmed.
    const confirmDismissed = await confirmPaymentClaimCore(ctx, {
      claimId: claim.id,
      amount: '30000',
    });
    expect(confirmDismissed).toEqual({ ok: false, error: 'claim_not_found' });
  });
});
