import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementChangeOrders } from '@/lib/engagements/queries';
import type {
  GenerateFeeSchedulePayload,
  RequestRevisionPayload,
} from '@/lib/engagements/transitions';
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

async function conceptLockedAt(engagementId: string): Promise<string | null> {
  const [row] = await raw.query<{ concept_locked_at: string | null }>(
    `select concept_locked_at from public.design_engagements where id = '${engagementId}'`,
  );
  return row.concept_locked_at;
}

async function confirmConceptTransitionCount(
  engagementId: string,
): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'confirmConcept'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement and drive it all the way
 * to `negotiation`: submitDesignFee -> recordPayment(deposit) ->
 * confirmAndPayDeposit -> recordArtifact(survey) -> spatialBaseReady -> 2
 * concept_option artifacts -> optionsReady -> recordPayment(gate_a) ->
 * selectConcept. Mirrors the Step-8 revision-dbtest setup, then the negotiation
 * exit (`confirmConcept`) can be exercised.
 */
async function setupNegotiation(): Promise<{
  ctx: OrgContext;
  engagementId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
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
    offPlan: false,
  });
  const engagementId = (created as { data?: string }).data!;
  const submitted = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: AMOUNT_SPLIT,
  });
  expect(submitted.ok).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
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
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  const selected = await executeTransition(ctx, {
    engagementId,
    trigger: 'selectConcept',
  });
  expect(selected.ok).toBe(true);
  expect(await stateOf(engagementId)).toBe('negotiation');
  return { ctx, engagementId };
}

function requestRevision(
  ctx: OrgContext,
  engagementId: string,
  payload?: RequestRevisionPayload,
) {
  return executeTransition(ctx, {
    engagementId,
    trigger: 'requestRevision',
    payload,
  });
}

function confirmConcept(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'confirmConcept' });
}

/**
 * Drive `count` over-allowance revisions, each raising ONE change order of
 * `amount`. The free allowance is N=3, so the caller must have already consumed
 * it (fresh engagement: first 3 requestRevision are free) — this helper burns the
 * 3 free revisions once, then raises `count` change orders.
 */
async function raiseChangeOrders(
  ctx: OrgContext,
  engagementId: string,
  amounts: string[],
): Promise<void> {
  for (let i = 0; i < 3; i++) {
    expect((await requestRevision(ctx, engagementId)).ok).toBe(true);
  }
  for (const amount of amounts) {
    const res = await requestRevision(ctx, engagementId, {
      changeOrderAmount: amount,
    });
    expect(res.ok).toBe(true);
  }
}

describe('confirmConcept — no outstanding change orders', () => {
  it('with no change orders: advances to design_3d, one transition row, concept_locked_at set', async () => {
    const { ctx, engagementId } = await setupNegotiation();

    const res = await confirmConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await confirmConceptTransitionCount(engagementId)).toBe(1);
    expect(await conceptLockedAt(engagementId)).not.toBeNull();
  });

  it('free revisions (within the allowance) raise NO change order, so confirmConcept passes', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    // Three free revisions — no change order is written.
    for (let i = 0; i < 3; i++) {
      expect((await requestRevision(ctx, engagementId)).ok).toBe(true);
    }
    const res = await confirmConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await conceptLockedAt(engagementId)).not.toBeNull();
  });
});

describe('confirmConcept — the money gate blocks on outstanding change orders', () => {
  it('a raised, unpaid CO: revision_cos_outstanding, stays negotiation, CO stays raised, lock null, no transition row', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    await raiseChangeOrders(ctx, engagementId, ['7500']);

    const res = await confirmConcept(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'revision_cos_outstanding' });
    expect(await stateOf(engagementId)).toBe('negotiation');
    const [co] = await getEngagementChangeOrders(ctx, engagementId);
    expect(co.status).toBe('raised');
    expect(co.settledAt).toBeNull();
    expect(await conceptLockedAt(engagementId)).toBeNull();
    expect(await confirmConceptTransitionCount(engagementId)).toBe(0);
  });

  it('KIND-ISOLATION: a gate_a/deposit payment of the same size does NOT settle a revision CO', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    await raiseChangeOrders(ctx, engagementId, ['5000']);
    // Same-sized receipts of the WRONG kind — must not settle the change order.
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '5000' });
    await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '5000' });

    const res = await confirmConcept(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'revision_cos_outstanding' });
    expect(await stateOf(engagementId)).toBe('negotiation');
    const [co] = await getEngagementChangeOrders(ctx, engagementId);
    expect(co.status).toBe('raised');
    expect(await conceptLockedAt(engagementId)).toBeNull();
  });
});

describe('confirmConcept — settlement on a covered change order', () => {
  it('a revision_co payment >= the CO amount: advances, CO settled with settled_at, lock set', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    await raiseChangeOrders(ctx, engagementId, ['7500.50']);
    // A revision_co payment covering the change order.
    await recordPaymentCore(ctx, {
      engagementId,
      kind: 'revision_co',
      amount: '7500.50',
    });

    const res = await confirmConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await confirmConceptTransitionCount(engagementId)).toBe(1);

    const [co] = await getEngagementChangeOrders(ctx, engagementId);
    expect(co.status).toBe('settled');
    expect(co.settledAt).not.toBeNull();
    expect(await conceptLockedAt(engagementId)).not.toBeNull();
  });

  it('partial revision_co payments summing to the CO total clear the gate', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    await raiseChangeOrders(ctx, engagementId, ['6000']);
    // Two partial revision_co payments summing to the 6000 total.
    await recordPaymentCore(ctx, { engagementId, kind: 'revision_co', amount: '2500' });
    // Still short before the second payment.
    expect((await confirmConcept(ctx, engagementId)).error).toBe(
      'revision_cos_outstanding',
    );
    await recordPaymentCore(ctx, { engagementId, kind: 'revision_co', amount: '3500' });

    const res = await confirmConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    const [co] = await getEngagementChangeOrders(ctx, engagementId);
    expect(co.status).toBe('settled');
    expect(co.settledAt).not.toBeNull();
  });
});

describe('confirmConcept — aggregate over two change orders', () => {
  it('two raised COs: a payment covering only one is still blocked; paying the rest settles BOTH', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    // Two over-allowance revisions -> two raised change orders (1000 + 2000).
    await raiseChangeOrders(ctx, engagementId, ['1000', '2000']);

    // A revision_co payment covering only ONE CO's worth is not enough — the gate
    // aggregates: paid must be >= Σ raised (3000).
    await recordPaymentCore(ctx, { engagementId, kind: 'revision_co', amount: '1000' });
    expect((await confirmConcept(ctx, engagementId)).error).toBe(
      'revision_cos_outstanding',
    );
    expect(await stateOf(engagementId)).toBe('negotiation');
    // Both change orders are still raised.
    for (const co of await getEngagementChangeOrders(ctx, engagementId)) {
      expect(co.status).toBe('raised');
    }

    // Paying the remainder clears the gate and settles BOTH change orders.
    await recordPaymentCore(ctx, { engagementId, kind: 'revision_co', amount: '2000' });
    const res = await confirmConcept(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('design_3d');
    const orders = await getEngagementChangeOrders(ctx, engagementId);
    expect(orders).toHaveLength(2);
    for (const co of orders) {
      expect(co.status).toBe('settled');
      expect(co.settledAt).not.toBeNull();
    }
    expect(await conceptLockedAt(engagementId)).not.toBeNull();
  });
});

describe('confirmConcept — cross-org isolation', () => {
  it('org B cannot confirmConcept on org A’s engagement', async () => {
    const { engagementId: aEngagement } = await setupNegotiation();

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await confirmConcept(ctxB, aEngagement);
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    // A is untouched: still in negotiation, no lock, no transition row.
    expect(await stateOf(aEngagement)).toBe('negotiation');
    expect(await conceptLockedAt(aEngagement)).toBeNull();
    expect(await confirmConceptTransitionCount(aEngagement)).toBe(0);
  });
});
