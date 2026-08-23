import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementEvents } from '@/lib/engagements/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A 4-milestone AMOUNT split: deposit 30,000, gate_a 20,000 (fee 100,000).
const AMOUNT_SPLIT: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function selectConceptTransitionCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'selectConcept'`,
  );
  return Number(row.n);
}

async function conceptApprovalEventCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_events
     where engagement_id = '${engagementId}' and kind = 'concept_approval'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement and drive it all the way
 * to `concept_review`: submitDesignFee -> recordPayment(deposit) ->
 * confirmAndPayDeposit -> recordArtifact(survey) -> spatialBaseReady -> 2
 * concept_option artifacts -> optionsReady. Reuses the Step-6 concept-dbtest
 * setup pattern, then the `selectConcept` (concept_review -> negotiation) Gate-A
 * gate can be exercised.
 */
async function setupConceptReview(
  fee: GenerateFeeSchedulePayload = AMOUNT_SPLIT,
  depositAmount = '30000',
): Promise<{
  ctx: OrgContext;
  engagementId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme' });
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
    offPlan: false,
  });
  const engagementId = (created as { data?: string }).data!;
  const submitted = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: fee,
  });
  expect(submitted.ok).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: depositAmount });
  const confirmed = await executeTransition(ctx, {
    engagementId,
    trigger: 'confirmAndPayDeposit',
  });
  expect(confirmed.ok).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  const advanced = await executeTransition(ctx, {
    engagementId,
    trigger: 'spatialBaseReady',
  });
  expect(advanced.ok).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  const options = await executeTransition(ctx, {
    engagementId,
    trigger: 'optionsReady',
  });
  expect(options.ok).toBe(true);
  expect(await stateOf(engagementId)).toBe('concept_review');
  return { ctx, engagementId };
}

function selectConcept(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'selectConcept' });
}

describe('selectConcept — gated on the Gate-A installment clearing', () => {
  it('with NO gate_a paid: gate_a_not_cleared, stays concept_review, no approval event', async () => {
    const { ctx, engagementId } = await setupConceptReview();
    const res = await selectConcept(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'gate_a_not_cleared' });
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await selectConceptTransitionCount(engagementId)).toBe(0);
    expect(await conceptApprovalEventCount(engagementId)).toBe(0);
  });

  it('with a gate_a payment short by a piastre: still blocked, no move, no event', async () => {
    const { ctx, engagementId } = await setupConceptReview();
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'gate_a',
      amount: '19999.9999',
    });
    const res = await selectConcept(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'gate_a_not_cleared' });
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await selectConceptTransitionCount(engagementId)).toBe(0);
    expect(await conceptApprovalEventCount(engagementId)).toBe(0);
  });

  it('with a sufficient gate_a payment: advances to negotiation with one transition + one approval event', async () => {
    const { ctx, engagementId } = await setupConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
    const res = await selectConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect(await selectConceptTransitionCount(engagementId)).toBe(1);
    expect(await conceptApprovalEventCount(engagementId)).toBe(1);

    // The approval event carries kind + the internal actor, readable in-org.
    const events = await getEngagementEvents(ctx, engagementId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('concept_approval');
    expect(events[0].actorUserId).toBe(ctx.userId);
  });

  it('TWO partial gate_a payments summing to the required amount clear the gate', async () => {
    const { ctx, engagementId } = await setupConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '12000' });
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '8000' });
    const res = await selectConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect(await conceptApprovalEventCount(engagementId)).toBe(1);
  });

  it('a non-gate_a payment does NOT count toward the Gate-A requirement', async () => {
    const { ctx, engagementId } = await setupConceptReview();
    // A deposit-kind receipt of the right size must not satisfy the gate_a gate.
    await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '20000' });
    const res = await selectConcept(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'gate_a_not_cleared' });
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await conceptApprovalEventCount(engagementId)).toBe(0);
  });

  // Step-14 milestoneCleared regression: "absent milestone = free gate".
  it('a DEPOSIT-ONLY schedule (no gate_a milestone) clears Gate A for FREE', async () => {
    // deposit is the only milestone (fee 100,000): gate_a was never scheduled, so
    // selectConcept advances with NO gate_a payment recorded.
    const DEPOSIT_ONLY: GenerateFeeSchedulePayload = {
      designFee: '100000',
      milestones: [{ kind: 'deposit', basis: 'amount', value: '100000' }],
    };
    const { ctx, engagementId } = await setupConceptReview(DEPOSIT_ONLY, '100000');

    const res = await selectConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect(await conceptApprovalEventCount(engagementId)).toBe(1);
    // No gate_a receipt exists — the gate opened for free.
    const [paid] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.payment_events
        where engagement_id = '${engagementId}' and kind = 'gate_a'`,
    );
    expect(Number(paid.n)).toBe(0);
  });
});

describe('engagement_events — append-only (SELECT + INSERT grants only)', () => {
  it('a direct UPDATE / DELETE under org context is denied; the row survives', async () => {
    const { ctx, engagementId } = await setupConceptReview();
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
    const res = await selectConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await conceptApprovalEventCount(engagementId)).toBe(1);

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.engagement_events set note = 'tampered' where engagement_id = '${engagementId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `delete from public.engagement_events where engagement_id = '${engagementId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    expect(await conceptApprovalEventCount(engagementId)).toBe(1);
  });
});

describe('selectConcept — cross-org isolation', () => {
  it('org B cannot advance org A’s engagement out of concept_review', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupConceptReview();
    // A has a cleared Gate-A installment — the gate would pass for A.
    await recordPaymentCore(ctxA, {
      engagementId: aEngagement,
      kind: 'gate_a',
      amount: '20000',
    });

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await selectConcept(ctxB, aEngagement);
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(aEngagement)).toBe('concept_review');
    expect(await selectConceptTransitionCount(aEngagement)).toBe(0);
    expect(await conceptApprovalEventCount(aEngagement)).toBe(0);

    // B also reads an empty approvals ledger for A's engagement (RLS scopes it).
    expect(await getEngagementEvents(ctxB, aEngagement)).toHaveLength(0);
  });
});
