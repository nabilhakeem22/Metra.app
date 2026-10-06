import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { confirmPaymentClaimAndAdvanceCore } from '@/lib/engagements/confirm-claim-and-advance';
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
  await createClientCore(ctx, { phone: '01000000000', nameEn: `Acme ${suffix}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
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

// Round A1 fix (R1): this block used to pin that a hand-logged payment for the
// SAME milestone still records while the client's claim is pending. That is the
// double-count: the claim, once confirmed, writes the money a second time. A
// pending claim now blocks a manual payment for its milestone only.
describe('client payment claim — a pending claim holds its own milestone only', () => {
  it('recordPayment for the claimed milestone is claim_pending_for_milestone, writes nothing', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('pending-blocks');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });

    const pay = await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
    expect(pay).toEqual({ ok: false, error: 'claim_pending_for_milestone' });
    expect(await paymentRows(engagementId)).toHaveLength(0);

    // Another milestone is not held.
    expect((await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '100' })).ok).toBe(true);
  });

  it('once the claim is confirmed, the legal transition fires', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('never-blocked');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);
    expect((await confirmPaymentClaimCore(ctx, { claimId: claim.id, amount: '30000' })).ok).toBe(true);
    const advance = await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' });
    expect(advance.ok).toBe(true);
  });
});

describe('confirmPaymentClaimCore — never counts the same money twice (R1)', () => {
  it('a milestone already paid in full is claim_already_settled; no second row; Dismiss still works', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('already-settled');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);
    // The deposit reached the ledger by another path (BYPASSRLS raw insert: the
    // app paths now refuse while the claim is pending).
    await raw.query(
      `insert into public.payment_events (org_id, engagement_id, kind, amount, recorded_by)
       values ('${ctx.orgId}', '${engagementId}', 'deposit', 30000, '${ctx.userId}')`,
    );

    const res = await confirmPaymentClaimCore(ctx, { claimId: claim.id, amount: '30000' });
    expect(res).toEqual({ ok: false, error: 'claim_already_settled' });
    expect(await paymentRows(engagementId)).toHaveLength(1);
    expect((await claimRows(engagementId))[0].status).toBe('pending');
    expect((await dismissPaymentClaimCore(ctx, { claimId: claim.id })).ok).toBe(true);
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

  it('writes ONE payment row keyed by the namespaced claim key, flips claim to confirmed; second confirm is already', async () => {
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
    // NAMESPACED, not the bare claim id: recordPaymentCore only accepts a UUID
    // key, so nothing outside this core can mint a row in this namespace.
    expect(payments[0].idempotency_key).toBe(`claim:${claim.id}`);

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

  // THE FORGERY THIS CLOSES: the key used to be the bare claim id, which is a
  // UUID and therefore mintable through recordPaymentCore by anyone who knew the
  // id. A 1 EGP pre-insert would have been adopted as the claim's payment.
  it('a payment pre-inserted under the bare claim id cannot hijack the confirmation', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-forge');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);

    const decoy = await recordPaymentCore(ctx, {
      engagementId,
      kind: 'gate_a',
      amount: '1',
      idempotencyKey: claim.id,
    });
    expect(decoy.ok).toBe(true);

    const res = await confirmPaymentClaimCore(ctx, {
      claimId: claim.id,
      amount: '30000',
    });
    expect(res.ok).toBe(true);

    const payments = await paymentRows(engagementId);
    expect(payments).toHaveLength(2);
    const decoyRow = payments.find((p) => p.idempotency_key === claim.id);
    const claimRow = payments.find(
      (p) => p.idempotency_key === `claim:${claim.id}`,
    );
    // The decoy is untouched and separate; the claim points at the real 30000.
    expect(decoyRow?.amount).toBe('1.0000');
    expect(decoyRow?.kind).toBe('gate_a');
    expect(claimRow?.amount).toBe('30000.0000');
    expect(claimRow?.kind).toBe('deposit');
    const [confirmed] = await claimRows(engagementId);
    expect(confirmed.confirmed_payment_event_id).toBe(claimRow?.id);
  });

  it('recordPaymentCore REFUSES a key in the claim namespace', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-ns');
    await claimPaymentByToken(token, { milestoneKind: 'deposit' });
    const [claim] = await claimRows(engagementId);

    expect(
      await recordPaymentCore(ctx, {
        engagementId,
        kind: 'deposit',
        amount: '30000',
        idempotencyKey: `claim:${claim.id}`,
      }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(await paymentRows(engagementId)).toHaveLength(0);
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

describe('client_payment_claims_resolution — status and resolution agree (M5)', () => {
  /** Insert a claim row directly, returning the SQLSTATE the database raised. */
  async function insertClaim(
    orgId: string,
    engagementId: string,
    columns: Record<string, string>,
  ): Promise<string | null> {
    const base: Record<string, string> = {
      org_id: `'${orgId}'`,
      engagement_id: `'${engagementId}'`,
      milestone_kind: `'balance'`,
      claimed_amount: `'1000'`,
      ...columns,
    };
    try {
      await raw.query(
        `insert into public.client_payment_claims (${Object.keys(base).join(', ')})
         values (${Object.values(base).join(', ')})`,
      );
      return null;
    } catch (error) {
      return sqlstateOf(error) ?? 'unknown';
    }
  }

  it('refuses a pending claim that already carries a resolution', async () => {
    const { ctx, engagementId } = await seedClaimDelivery('check-pending');
    expect(
      await insertClaim(ctx.orgId, engagementId, {
        status: `'pending'`,
        resolved_at: 'now()',
      }),
    ).toBe('23514');
  });

  it('refuses a confirmed claim with no payment event behind it', async () => {
    const { ctx, engagementId } = await seedClaimDelivery('check-confirmed');
    expect(
      await insertClaim(ctx.orgId, engagementId, {
        status: `'confirmed'`,
        resolved_at: 'now()',
        resolved_by: `'${ctx.userId}'`,
      }),
    ).toBe('23514');
  });

  it('refuses a dismissed claim with no resolved_at', async () => {
    const { ctx, engagementId } = await seedClaimDelivery('check-dismissed');
    expect(
      await insertClaim(ctx.orgId, engagementId, { status: `'dismissed'` }),
    ).toBe('23514');
  });

  it('accepts an ordinary pending claim', async () => {
    const { ctx, engagementId } = await seedClaimDelivery('check-ok');
    expect(await insertClaim(ctx.orgId, engagementId, {})).toBeNull();
  });
});

/** Drive design_proposal -> concept_review through the machine (deposit, survey, 2 options). */
async function toConceptReview(ctx: OrgContext, engagementId: string): Promise<void> {
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' })).ok).toBe(
    true,
  );
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' })).ok).toBe(
    true,
  );
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  expect((await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok).toBe(true);
}

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

describe('confirmPaymentClaimAndAdvanceCore (round A1)', () => {
  it('a full gate_a claim confirmed at concept_review ends in negotiation', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-advance');
    await toConceptReview(ctx, engagementId);
    await claimPaymentByToken(token, { milestoneKind: 'gate_a' });
    const [claim] = (await claimRows(engagementId)).filter((row) => row.milestone_kind === 'gate_a');

    const res = await confirmPaymentClaimAndAdvanceCore(ctx, {
      claimId: claim.id,
      amount: claim.claimed_amount,
    });
    expect(res).toMatchObject({ ok: true, paymentRecorded: true, advanced: true });
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect((await claimRows(engagementId)).find((row) => row.id === claim.id)?.status).toBe(
      'confirmed',
    );
  });

  it('a balance claim at execution_decision is recorded and never picks an ending', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-choice');
    await forceState(engagementId, 'execution_decision');
    await claimPaymentByToken(token, { milestoneKind: 'balance' });
    const [claim] = await claimRows(engagementId);

    const res = await confirmPaymentClaimAndAdvanceCore(ctx, {
      claimId: claim.id,
      amount: claim.claimed_amount,
    });
    expect(res).toMatchObject({ ok: true, paymentRecorded: true, advanced: false });
    expect(await stateOf(engagementId)).toBe('execution_decision');
    const payments = await paymentRows(engagementId);
    expect(payments).toHaveLength(1);
    expect(payments[0].kind).toBe('balance');
  });

  it("a foreign org's claim reads as claim_not_found and writes nothing", async () => {
    const a = await seedClaimDelivery('confirm-advance-iso');
    await claimPaymentByToken(a.token, { milestoneKind: 'deposit' });
    const [claimA] = await claimRows(a.engagementId);
    const { orgId: orgB, ownerIds: ownersB } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);

    const res = await confirmPaymentClaimAndAdvanceCore(ctxFor(orgB, ownersB[0], 'owner'), {
      claimId: claimA.id,
      amount: '30000',
    });
    expect(res).toEqual({
      ok: false,
      error: 'claim_not_found',
      paymentRecorded: false,
      advanced: false,
    });
    expect(await paymentRows(a.engagementId)).toHaveLength(0);
    expect(await stateOf(a.engagementId)).toBe('design_proposal');
  });
});

describe('confirmPaymentClaimAndAdvanceCore — results and fences (round A1 fix)', () => {
  it('a short amount records the payment and reports what is still waiting, as ok', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-short');
    await toConceptReview(ctx, engagementId);
    await claimPaymentByToken(token, { milestoneKind: 'gate_a' });
    const [claim] = (await claimRows(engagementId)).filter((row) => row.milestone_kind === 'gate_a');

    const res = await confirmPaymentClaimAndAdvanceCore(ctx, { claimId: claim.id, amount: '19999' });
    expect(res).toMatchObject({
      ok: true,
      paymentRecorded: true,
      advanced: false,
      waitingOn: 'gate_a_not_cleared',
    });
    expect(await stateOf(engagementId)).toBe('concept_review');
  });

  it('a repeated confirm converges: ok and already, no stale advance error', async () => {
    const { ctx, engagementId, token } = await seedClaimDelivery('confirm-twice');
    await toConceptReview(ctx, engagementId);
    await claimPaymentByToken(token, { milestoneKind: 'gate_a' });
    const [claim] = (await claimRows(engagementId)).filter((row) => row.milestone_kind === 'gate_a');
    const input = { claimId: claim.id, amount: claim.claimed_amount };

    expect(await confirmPaymentClaimAndAdvanceCore(ctx, input)).toMatchObject({ ok: true, advanced: true });
    const again = await confirmPaymentClaimAndAdvanceCore(ctx, input);
    expect(again).toMatchObject({ ok: true, already: true, paymentRecorded: true, advanced: false });
    expect(again.waitingOn).toBeUndefined();
    expect(await stateOf(engagementId)).toBe('negotiation');
  });

  it('refuses a role without finance create, and a non-UUID claim id, before any read', async () => {
    const { orgId, memberIds } = await seedOrg({ owners: 1, members: [{ role: 'viewer' }] });
    orgIds.push(orgId);
    const viewer = ctxFor(orgId, memberIds[0], 'viewer');
    expect(
      await confirmPaymentClaimAndAdvanceCore(viewer, {
        claimId: '33333333-3333-4333-8333-333333333333',
        amount: '1',
      }),
    ).toEqual({ ok: false, error: 'forbidden', paymentRecorded: false, advanced: false });
    const owner = ctxFor(orgId, memberIds[0], 'owner');
    expect(
      await confirmPaymentClaimAndAdvanceCore(owner, { claimId: 'not-a-uuid', amount: '1' }),
    ).toEqual({ ok: false, error: 'invalid', paymentRecorded: false, advanced: false });
  });
});
