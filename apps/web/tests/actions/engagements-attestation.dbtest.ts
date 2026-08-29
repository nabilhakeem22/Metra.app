import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { withOrgContext } from '@/lib/db/context';
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

/** The as_built_attestation event rows for an engagement (BYPASSRLS connection). */
async function attestationRows(engagementId: string) {
  return raw.query<{ id: string; has_variance: boolean | null }>(
    `select id, has_variance from public.engagement_events
      where engagement_id = '${engagementId}' and kind = 'as_built_attestation'
      order by decided_at`,
  );
}

/** Transition-ledger row count for one trigger on an engagement. */
async function transitionCount(
  engagementId: string,
  trigger: string,
): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = '${trigger}'`,
  );
  return Number(row.n);
}

function flagAsBuiltVariance(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'flagAsBuiltVariance' });
}

function attestAsBuiltClean(ctx: OrgContext, engagementId: string) {
  return executeTransition(ctx, { engagementId, trigger: 'attestAsBuiltClean' });
}

/**
 * Seed an org + client + project, create ONE engagement (Off-Plan controlled by
 * `offPlan`) and drive it all the way to `final_approval`: submitDesignFee ->
 * recordPayment(deposit) -> confirmAndPayDeposit -> recordArtifact(survey) ->
 * spatialBaseReady -> 2 concept_option artifacts -> optionsReady ->
 * recordPayment(gate_a) -> selectConcept -> confirmConcept -> 2 approved_render
 * artifacts -> rendersReady. For an Off-Plan engagement, confirmAndPayDeposit sets
 * `as_built_due` true (the `asBuiltDueOpen` gate for the attestations). Mirrors the
 * Step-11 renders setup, parameterized by `offPlan`.
 */
async function setupFinalApproval(offPlan: boolean): Promise<{
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
    offPlan,
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
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
  ).toBe(true);
  expect(await stateOf(engagementId)).toBe('final_approval');
  return { ctx, engagementId };
}

describe('as-built attestation — Off-Plan (as_built_due is true)', () => {
  it('flagAsBuiltVariance: final_approval -> change_triage, one variance event, one transition row', async () => {
    const { ctx, engagementId } = await setupFinalApproval(true);

    const res = await flagAsBuiltVariance(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('change_triage');

    const rows = await attestationRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].has_variance).toBe(true);
    expect(await transitionCount(engagementId, 'flagAsBuiltVariance')).toBe(1);
  });

  it('attestAsBuiltClean: change_triage -> final_approval, appends a clean attestation', async () => {
    const { ctx, engagementId } = await setupFinalApproval(true);
    // First flag the variance to move into change_triage.
    expect((await flagAsBuiltVariance(ctx, engagementId)).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('change_triage');

    const res = await attestAsBuiltClean(ctx, engagementId);
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('final_approval');

    // Two attestation events now: the variance, then the clean reconciliation.
    const rows = await attestationRows(engagementId);
    expect(rows).toHaveLength(2);
    expect(rows[0].has_variance).toBe(true);
    expect(rows[1].has_variance).toBe(false);
    expect(await transitionCount(engagementId, 'attestAsBuiltClean')).toBe(1);
  });

  it('attestAsBuiltClean from final_approval: self-loop stays final_approval, appends a clean attestation', async () => {
    const { ctx, engagementId } = await setupFinalApproval(true);

    const res = await attestAsBuiltClean(ctx, engagementId);
    expect(res.ok).toBe(true);
    // The self-loop targets final_approval — the state is unchanged.
    expect(await stateOf(engagementId)).toBe('final_approval');

    const rows = await attestationRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].has_variance).toBe(false);
    expect(await transitionCount(engagementId, 'attestAsBuiltClean')).toBe(1);
  });

  it('abandon from change_triage is a LEGAL from-state (guard-less off-ramp, tail wiring)', async () => {
    const { ctx, engagementId } = await setupFinalApproval(true);
    expect((await flagAsBuiltVariance(ctx, engagementId)).ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('change_triage');

    // change_triage is in abandon's from-set and abandon is wired guard-less
    // (the UI confirm-gates it), so the off-ramp fires — NOT illegal_trigger.
    const res = await executeTransition(ctx, { engagementId, trigger: 'abandon' });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('abandoned');
  });

  it('a direct UPDATE / DELETE on an attestation event is denied (append-only grants)', async () => {
    const { ctx, engagementId } = await setupFinalApproval(true);
    expect((await flagAsBuiltVariance(ctx, engagementId)).ok).toBe(true);

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.engagement_events set has_variance = false
               where engagement_id = '${engagementId}' and kind = 'as_built_attestation'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `delete from public.engagement_events
               where engagement_id = '${engagementId}' and kind = 'as_built_attestation'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    // The row survives both attempts, unchanged.
    const rows = await attestationRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].has_variance).toBe(true);
  });
});

describe('as-built attestation — non-Off-Plan (as_built_due is false)', () => {
  it('flagAsBuiltVariance fails as_built_not_due: no state change, no event', async () => {
    const { ctx, engagementId } = await setupFinalApproval(false);

    const res = await flagAsBuiltVariance(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'as_built_not_due' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await attestationRows(engagementId)).toHaveLength(0);
    expect(await transitionCount(engagementId, 'flagAsBuiltVariance')).toBe(0);
  });

  it('attestAsBuiltClean fails as_built_not_due: no state change, no event', async () => {
    const { ctx, engagementId } = await setupFinalApproval(false);

    const res = await attestAsBuiltClean(ctx, engagementId);
    expect(res).toEqual({ ok: false, error: 'as_built_not_due' });
    expect(await stateOf(engagementId)).toBe('final_approval');
    expect(await attestationRows(engagementId)).toHaveLength(0);
    expect(await transitionCount(engagementId, 'attestAsBuiltClean')).toBe(0);
  });
});

describe('as-built attestation — cross-org isolation', () => {
  it('org B cannot flagAsBuiltVariance on org A’s engagement', async () => {
    const { engagementId: aEngagement } = await setupFinalApproval(true);

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    const res = await flagAsBuiltVariance(ctxB, aEngagement);
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    // A is untouched: still final_approval, no attestation event, no transition row.
    expect(await stateOf(aEngagement)).toBe('final_approval');
    expect(await attestationRows(aEngagement)).toHaveLength(0);
    expect(await transitionCount(aEngagement, 'flagAsBuiltVariance')).toBe(0);
  });
});
