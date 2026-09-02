import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementRenderManifest } from '@/lib/engagements/queries';
import { computeRenderManifestHash } from '@/lib/engagements/renders';
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

async function rendersReadyTransitionCount(
  engagementId: string,
): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'rendersReady'`,
  );
  return Number(row.n);
}

function rendersReady(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'rendersReady' });
}

/**
 * Seed an org + client + project, create ONE engagement and drive it all the way
 * to `design_3d`: submitDesignFee -> recordPayment(deposit) ->
 * confirmAndPayDeposit -> recordArtifact(survey) -> spatialBaseReady -> 2
 * concept_option artifacts -> optionsReady -> recordPayment(gate_a) ->
 * selectConcept -> confirmConcept (no change orders). Mirrors the Step-9
 * `setupNegotiation` pattern, then confirms the concept to reach design_3d.
 */
async function setupDesign3d(): Promise<{
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
  expect(
    (
      await executeTransition(ctx, {
        engagementId,
        trigger: 'submitDesignFee',
        payload: AMOUNT_SPLIT,
      })
    ).ok,
  ).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' }))
      .ok,
  ).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' })).ok,
  ).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok,
  ).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'selectConcept' })).ok,
  ).toBe(true);
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' })).ok,
  ).toBe(true);
  expect(await stateOf(engagementId)).toBe('design_3d');
  return { ctx, engagementId };
}

describe('rendersReady — the guard blocks with no approved render', () => {
  it('no approved_render: renders_missing, stays design_3d, no transition row, manifest null', async () => {
    const { ctx, engagementId } = await setupDesign3d();

    const res = await rendersReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'renders_missing' });
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await rendersReadyTransitionCount(engagementId)).toBe(0);

    const manifest = await getEngagementRenderManifest(ctx, engagementId);
    expect(manifest.renderManifestHash).toBeNull();
    expect(manifest.rendersReadyAt).toBeNull();
  });

  it('a non-render artifact (survey) does NOT satisfy the guard', async () => {
    const { ctx, engagementId } = await setupDesign3d();
    // An extra survey in the bundle — not an approved_render, so the gate stays shut.
    await recordArtifactCore(ctx, { engagementId, kind: 'survey' });

    const res = await rendersReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'renders_missing' });
    expect(await stateOf(engagementId)).toBe('design_3d');
    expect(await rendersReadyTransitionCount(engagementId)).toBe(0);
  });
});

describe('rendersReady — advances and captures the baseline manifest', () => {
  it('two approved renders: advances to final_approval, one transition row, manifest + timestamp set', async () => {
    const { ctx, engagementId } = await setupDesign3d();
    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'approved_render',
      contentHash: 'hash-alpha',
    });
    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'approved_render',
      contentHash: 'hash-beta',
    });

    const res = await rendersReady(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await rendersReadyTransitionCount(engagementId)).toBe(1);

    const manifest = await getEngagementRenderManifest(ctx, engagementId);
    expect(manifest.renderManifestHash).not.toBeNull();
    expect(manifest.rendersReadyAt).not.toBeNull();

    // The stored hash matches computeRenderManifestHash over those two renders'
    // content hashes — deterministic and independent of insertion order.
    const expected = computeRenderManifestHash([
      { id: 'ignored-a', contentHash: 'hash-alpha' },
      { id: 'ignored-b', contentHash: 'hash-beta' },
    ]);
    expect(manifest.renderManifestHash).toBe(expected);
  });
});

describe('rendersReady — cross-org isolation', () => {
  it('org B cannot rendersReady on org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupDesign3d();
    await recordArtifactCore(ctxA, {
      engagementId: aEngagement,
      kind: 'approved_render',
      contentHash: 'hash-alpha',
    });

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await rendersReady(ctxB, aEngagement);
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    // A is untouched: still in design_3d, manifest null, no transition row.
    expect(await stateOf(aEngagement)).toBe('design_3d');
    expect(await rendersReadyTransitionCount(aEngagement)).toBe(0);
    const manifest = await getEngagementRenderManifest(ctxA, aEngagement);
    expect(manifest.renderManifestHash).toBeNull();
    expect(manifest.rendersReadyAt).toBeNull();
  });
});
