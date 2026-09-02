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

async function revisionCountOf(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select revision_count::int as n from public.design_engagements where id = '${engagementId}'`,
  );
  return Number(row.n);
}

/** The 3D allowance's counter — the concept loop must never touch it. */
async function designRevisionCountOf(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select design_revision_count::int as n from public.design_engagements
      where id = '${engagementId}'`,
  );
  return Number(row.n);
}

async function requestRevisionTransitionCount(
  engagementId: string,
): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'requestRevision'`,
  );
  return Number(row.n);
}

async function changeOrderCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_change_orders
     where engagement_id = '${engagementId}'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement and drive it all the way
 * to `negotiation`: submitDesignFee -> recordPayment(deposit) ->
 * confirmAndPayDeposit -> recordArtifact(survey) -> spatialBaseReady -> 2
 * concept_option artifacts -> optionsReady -> recordPayment(gate_a) ->
 * selectConcept. Mirrors the Step-7 gate-a-dbtest setup, then the negotiation
 * self-loop (`requestRevision`) can be exercised.
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

describe('requestRevision — free revisions within the allowance (N=3)', () => {
  it('the 1st/2nd/3rd revision with no amount: counter 1/2/3, stays negotiation, a transition each, ZERO change orders', async () => {
    const { ctx, engagementId } = await setupNegotiation();

    for (let expected = 1; expected <= 3; expected++) {
      const res = await requestRevision(ctx, engagementId);
      expect(res.ok).toBe(true);
      expect(await stateOf(engagementId)).toBe('negotiation');
      expect(await revisionCountOf(engagementId)).toBe(expected);
      expect(await requestRevisionTransitionCount(engagementId)).toBe(expected);
      expect(await changeOrderCount(engagementId)).toBe(0);
    }
  });

  it('a free revision IGNORES any supplied amount (no change order written)', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    const res = await requestRevision(ctx, engagementId, {
      changeOrderAmount: '5000',
    });
    expect(res.ok).toBe(true);
    expect(await revisionCountOf(engagementId)).toBe(1);
    expect(await changeOrderCount(engagementId)).toBe(0);
  });

  it('two concurrent requestRevision both count — atomic increment, no lost update', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    // A self-loop passes the executor's state gate for both callers (from == to),
    // so the counter must be incremented atomically at the DB, not read-then-write.
    const [a, b] = await Promise.all([
      requestRevision(ctx, engagementId),
      requestRevision(ctx, engagementId),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await revisionCountOf(engagementId)).toBe(2);
    expect(await requestRevisionTransitionCount(engagementId)).toBe(2);
    expect(await changeOrderCount(engagementId)).toBe(0);
    // Both increments landed on the CONCEPT counter only — the parameterised
    // side-effect must not spill into the independent 3D allowance.
    expect(await designRevisionCountOf(engagementId)).toBe(0);
  });
});

describe('requestRevision — crossing the free allowance raises a change order', () => {
  it('the 4th revision with NO amount: revision_co_amount_required, counter stays 3, no CO, no transition row (atomic rollback)', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    for (let i = 0; i < 3; i++) {
      expect((await requestRevision(ctx, engagementId)).ok).toBe(true);
    }
    expect(await revisionCountOf(engagementId)).toBe(3);
    expect(await requestRevisionTransitionCount(engagementId)).toBe(3);

    const res = await requestRevision(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'revision_co_amount_required' });
    // The whole transition rolled back: counter unchanged, no CO, no 4th row.
    expect(await revisionCountOf(engagementId)).toBe(3);
    expect(await changeOrderCount(engagementId)).toBe(0);
    expect(await requestRevisionTransitionCount(engagementId)).toBe(3);
    expect(await stateOf(engagementId)).toBe('negotiation');
  });

  it('the 4th with a valid amount: counter 4, exactly ONE raised change order with the canonical amount; a 5th raises a second CO', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    for (let i = 0; i < 3; i++) {
      expect((await requestRevision(ctx, engagementId)).ok).toBe(true);
    }

    const fourth = await requestRevision(ctx, engagementId, {
      changeOrderAmount: '7500.50',
      reason: 'Client changed the kitchen layout',
    });
    expect(fourth.ok).toBe(true);
    expect(await revisionCountOf(engagementId)).toBe(4);
    expect(await requestRevisionTransitionCount(engagementId)).toBe(4);
    // Four concept revisions later, the 3D allowance is still untouched and full.
    expect(await designRevisionCountOf(engagementId)).toBe(0);

    const orders = await getEngagementChangeOrders(ctx, engagementId);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('raised');
    expect(orders[0].amount).toBe('7500.5000');
    expect(orders[0].reason).toBe('Client changed the kitchen layout');
    expect(orders[0].raisedByUserId).toBe(ctx.userId);
    expect(orders[0].settledAt).toBeNull();

    // A 5th revision (also beyond the allowance) raises a SECOND change order.
    const fifth = await requestRevision(ctx, engagementId, {
      changeOrderAmount: '1000',
    });
    expect(fifth.ok).toBe(true);
    expect(await revisionCountOf(engagementId)).toBe(5);
    expect(await changeOrderCount(engagementId)).toBe(2);
    const after = await getEngagementChangeOrders(ctx, engagementId);
    expect(after).toHaveLength(2);
    // Newest first: the 5th (1000) leads the 4th (7500.5000).
    expect(after[0].amount).toBe('1000.0000');
    expect(after[1].amount).toBe('7500.5000');
  });

  it('a malformed (comma-decimal) amount on the crossing revision is rejected, nothing written', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    for (let i = 0; i < 3; i++) {
      expect((await requestRevision(ctx, engagementId)).ok).toBe(true);
    }
    const res = await requestRevision(ctx, engagementId, {
      changeOrderAmount: '1,5',
    });
    expect(res).toEqual({ ok: false, error: 'revision_co_amount_required' });
    expect(await revisionCountOf(engagementId)).toBe(3);
    expect(await changeOrderCount(engagementId)).toBe(0);
  });

  it('a zero amount on the crossing revision is rejected', async () => {
    const { ctx, engagementId } = await setupNegotiation();
    for (let i = 0; i < 3; i++) {
      expect((await requestRevision(ctx, engagementId)).ok).toBe(true);
    }
    const res = await requestRevision(ctx, engagementId, {
      changeOrderAmount: '0',
    });
    expect(res).toEqual({ ok: false, error: 'revision_co_amount_required' });
    expect(await changeOrderCount(engagementId)).toBe(0);
  });
});

describe('requestRevision — cross-org isolation', () => {
  it('org B cannot requestRevision on org A’s engagement, nor read its change orders', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupNegotiation();
    // Drive A past the free allowance so A has a real change order to hide.
    for (let i = 0; i < 3; i++) {
      expect((await requestRevision(ctxA, aEngagement)).ok).toBe(true);
    }
    expect(
      (await requestRevision(ctxA, aEngagement, { changeOrderAmount: '2000' }))
        .ok,
    ).toBe(true);
    expect(await changeOrderCount(aEngagement)).toBe(1);

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await requestRevision(ctxB, aEngagement, {
      changeOrderAmount: '9999',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    // A's counter + change orders are untouched by B.
    expect(await revisionCountOf(aEngagement)).toBe(4);
    expect(await changeOrderCount(aEngagement)).toBe(1);
    expect(await requestRevisionTransitionCount(aEngagement)).toBe(4);

    // B reads an EMPTY change-order list for A's engagement (RLS scopes it).
    expect(await getEngagementChangeOrders(ctxB, aEngagement)).toHaveLength(0);
  });
});
