import { afterAll, describe, expect, it } from 'vitest';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A 4-milestone AMOUNT split whose deposit requires 30,000 (fee 100,000).
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

async function optionsTransitionCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'optionsReady'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement and drive it all the way
 * to `layout`: submitDesignFee -> recordPayment(deposit) -> confirmAndPayDeposit
 * -> recordArtifact(survey) -> spatialBaseReady. Reuses the Step-5 survey-dbtest
 * setup pattern, then crosses the survey -> layout edge so the `optionsReady`
 * (layout -> concept_review) gate can be exercised.
 */
async function setupLayout(): Promise<{
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
  await recordPaymentCore(ctx, {
    engagementId,
    kind: 'deposit',
    amount: '30000',
  });
  const confirmed = await executeTransition(ctx, {
    engagementId,
    trigger: 'confirmAndPayDeposit',
  });
  expect(confirmed.ok).toBe(true);
  // survey -> layout: a measured survey is the stored spatial base.
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  const advanced = await executeTransition(ctx, {
    engagementId,
    trigger: 'spatialBaseReady',
  });
  expect(advanced.ok).toBe(true);
  expect(await stateOf(engagementId)).toBe('layout');
  return { ctx, engagementId };
}

function optionsReady(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'optionsReady' });
}

/** Record `count` concept_option artifacts against the engagement. */
async function recordConceptOptions(
  ctx: OrgContext,
  engagementId: string,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const res = await recordArtifactCore(ctx, {
      engagementId,
      kind: 'concept_option',
      label: `Concept ${index + 1}`,
    });
    expect(res.ok).toBe(true);
  }
}

describe('optionsReady — below the 2–4 range (stays layout)', () => {
  it('with 0 concept options: concept_options_out_of_range, no transition', async () => {
    const { ctx, engagementId } = await setupLayout();
    const res = await optionsReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'concept_options_out_of_range' });
    expect(await stateOf(engagementId)).toBe('layout');
    expect(await optionsTransitionCount(engagementId)).toBe(0);
  });

  it('with 1 concept option: concept_options_out_of_range, no transition', async () => {
    const { ctx, engagementId } = await setupLayout();
    await recordConceptOptions(ctx, engagementId, 1);
    const res = await optionsReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'concept_options_out_of_range' });
    expect(await stateOf(engagementId)).toBe('layout');
    expect(await optionsTransitionCount(engagementId)).toBe(0);
  });
});

describe('optionsReady — inside the 2–4 range (advances to concept_review)', () => {
  it('with exactly 2 concept options: advances with one transition row', async () => {
    const { ctx, engagementId } = await setupLayout();
    await recordConceptOptions(ctx, engagementId, 2);
    const res = await optionsReady(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await optionsTransitionCount(engagementId)).toBe(1);
  });

  it('with 3 concept options: advances', async () => {
    const { ctx, engagementId } = await setupLayout();
    await recordConceptOptions(ctx, engagementId, 3);
    const res = await optionsReady(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await optionsTransitionCount(engagementId)).toBe(1);
  });

  it('with 4 concept options: advances', async () => {
    const { ctx, engagementId } = await setupLayout();
    await recordConceptOptions(ctx, engagementId, 4);
    const res = await optionsReady(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('concept_review');
    expect(await optionsTransitionCount(engagementId)).toBe(1);
  });
});

describe('optionsReady — above the 2–4 range (stays layout)', () => {
  it('with 5 concept options: concept_options_out_of_range, no transition', async () => {
    const { ctx, engagementId } = await setupLayout();
    await recordConceptOptions(ctx, engagementId, 5);
    const res = await optionsReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'concept_options_out_of_range' });
    expect(await stateOf(engagementId)).toBe('layout');
    expect(await optionsTransitionCount(engagementId)).toBe(0);
  });
});

describe('optionsReady — only concept_option artifacts count', () => {
  it('an extra survey does NOT count toward the 2–4', async () => {
    const { ctx, engagementId } = await setupLayout();
    // 1 concept option + a second (non-concept) survey => still below the range.
    await recordConceptOptions(ctx, engagementId, 1);
    await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
    const res = await optionsReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'concept_options_out_of_range' });
    expect(await stateOf(engagementId)).toBe('layout');
    expect(await optionsTransitionCount(engagementId)).toBe(0);
  });
});

describe('optionsReady — cross-org isolation', () => {
  it('org B cannot advance org A’s engagement out of layout', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupLayout();
    // A has a valid 2-option set — the gate would pass for A.
    await recordConceptOptions(ctxA, aEngagement, 2);

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await optionsReady(ctxB, aEngagement);
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(aEngagement)).toBe('layout');
    expect(await optionsTransitionCount(aEngagement)).toBe(0);
  });
});
