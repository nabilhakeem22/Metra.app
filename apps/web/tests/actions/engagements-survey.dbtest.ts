import { afterAll, describe, expect, it } from 'vitest';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementArtifacts } from '@/lib/engagements/queries';
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

async function spatialTransitionCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
     where engagement_id = '${engagementId}' and trigger = 'spatialBaseReady'`,
  );
  return Number(row.n);
}

/**
 * Seed an org + client + project, create ONE engagement (optionally Off-Plan) and
 * drive it all the way to `survey`: submitDesignFee -> recordPayment(deposit) ->
 * confirmAndPayDeposit. Mirrors the Step-4 deposit-test setup.
 */
async function setupSurvey(opts?: {
  offPlan?: boolean;
}): Promise<{ ctx: OrgContext; engagementId: string }> {
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
    offPlan: opts?.offPlan ?? false,
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
  expect(await stateOf(engagementId)).toBe('survey');
  return { ctx, engagementId };
}

function spatialBaseReady(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' });
}

describe('recordArtifact — attest an engagement artifact', () => {
  it('records a survey artifact that then appears in getEngagementArtifacts', async () => {
    const { ctx, engagementId } = await setupSurvey();
    const res = await recordArtifactCore(ctx, {
      engagementId,
      kind: 'survey',
      label: 'Measured survey A',
      note: 'on-site laser scan',
    });
    expect(res.ok).toBe(true);
    expect(typeof res.data).toBe('string');

    const artifacts = await getEngagementArtifacts(ctx, engagementId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe('survey');
    expect(artifacts[0].label).toBe('Measured survey A');
    expect(artifacts[0].note).toBe('on-site laser scan');
    // Recording an artifact IS attesting it: attestedBy = the caller.
    expect(artifacts[0].attestedBy).toBe(ctx.userId);
  });

  it('rejects an invalid artifact kind', async () => {
    const { ctx, engagementId } = await setupSurvey();
    const res = await recordArtifactCore(ctx, {
      engagementId,
      kind: 'not_a_kind' as never,
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(await getEngagementArtifacts(ctx, engagementId)).toHaveLength(0);
  });

  it('rejects an artifact against a terminal (abandoned / closed) engagement', async () => {
    const { ctx, engagementId } = await setupSurvey();
    // Force a terminal state (abandon isn't wired yet — Step 6+).
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`,
    );
    const res = await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
    expect(res.ok).toBe(false);
    expect((res as { error?: string }).error).toBe('engagement_not_active');
    expect(await getEngagementArtifacts(ctx, engagementId)).toHaveLength(0);
  });
});

describe('spatialBaseReady — non-Off-Plan (a measured survey is required)', () => {
  it('with NO artifact: spatial_base_missing, stays survey, no transition', async () => {
    const { ctx, engagementId } = await setupSurvey({ offPlan: false });
    const res = await spatialBaseReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'spatial_base_missing' });
    expect(await stateOf(engagementId)).toBe('survey');
    expect(await spatialTransitionCount(engagementId)).toBe(0);
  });

  it('with only an autocad artifact: still spatial_base_missing (survey required)', async () => {
    const { ctx, engagementId } = await setupSurvey({ offPlan: false });
    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'autocad',
      label: 'Developer CAD set A',
    });
    const res = await spatialBaseReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'spatial_base_missing' });
    expect(await stateOf(engagementId)).toBe('survey');
    expect(await spatialTransitionCount(engagementId)).toBe(0);
  });

  it('with a survey artifact: advances to layout with exactly one transition row', async () => {
    const { ctx, engagementId } = await setupSurvey({ offPlan: false });
    await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
    const res = await spatialBaseReady(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('layout');
    expect(await spatialTransitionCount(engagementId)).toBe(1);
  });
});

describe('spatialBaseReady — Off-Plan (developer CAD accepted in lieu of a survey)', () => {
  it('with only an autocad (developer CAD) artifact: advances to layout', async () => {
    const { ctx, engagementId } = await setupSurvey({ offPlan: true });
    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'autocad',
      label: 'Developer CAD set A',
    });
    const res = await spatialBaseReady(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('layout');
    expect(await spatialTransitionCount(engagementId)).toBe(1);
  });

  it('with nothing recorded: spatial_base_missing, stays survey', async () => {
    const { ctx, engagementId } = await setupSurvey({ offPlan: true });
    const res = await spatialBaseReady(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'spatial_base_missing' });
    expect(await stateOf(engagementId)).toBe('survey');
    expect(await spatialTransitionCount(engagementId)).toBe(0);
  });
});

describe('cross-org isolation', () => {
  it('org B cannot record or read artifacts on org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setupSurvey();

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    // A records a real survey against its own engagement.
    await recordArtifactCore(ctxA, { engagementId: aEngagement, kind: 'survey' });

    // B reads A's engagement id -> RLS scopes it to an empty artifact list.
    expect(await getEngagementArtifacts(ctxB, aEngagement)).toHaveLength(0);

    // B tries to record against A's engagement -> engagement_not_found (RLS hides it).
    const res = await recordArtifactCore(ctxB, {
      engagementId: aEngagement,
      kind: 'survey',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });

    // And B cannot advance A's engagement.
    const advance = await spatialBaseReady(ctxB, aEngagement);
    expect(advance).toEqual({ ok: false, error: 'engagement_not_found' });
    expect(await stateOf(aEngagement)).toBe('survey');
  });
});
