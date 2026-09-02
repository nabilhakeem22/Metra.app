// Epic D, Slice 3 — the Hero gate preview + the combined pay-and-advance core.
// Proves (1) getEngagementGatePreview mirrors the guard engine one-for-one: the
// forward trigger's payment guard is ok:false with amountDue = the milestone
// shortfall, a non-money guard carries amountDue:null, and an all-clear gate has
// every item ok; and (2) logPaymentAndAdvanceCore records-then-advances, fails
// safe (a short payment persists but the state does NOT advance and the guard
// error is returned), rejects a terminal engagement, and stays gated on the
// interior flow — all through the reused cores (no gate bypassed).
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import { logPaymentAndAdvanceCore } from '@/lib/engagements/pay-and-advance';
import { recordPaymentCore } from '@/lib/engagements/payments';
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

// deposit 30,000, gate_a 20,000, gate_b 20,000, balance 30,000 (fee 100,000).
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

async function gateAPaymentCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.payment_events
     where engagement_id = '${engagementId}' and kind = 'gate_a'`,
  );
  return Number(row.n);
}

async function setEnabledFlows(orgId: string, flows: string): Promise<void> {
  // BYPASSRLS raw update of the seeded entitlement row (the fixture seeds
  // `{interior}`), mirroring entitlements.dbtest — never an UPDATE under metra_app.
  await raw.query(
    `update public.workspace_entitlements set enabled_flows = '${flows}' where org_id = '${orgId}'`,
  );
}

/** Seed an org + client + project, create ONE engagement and submit its fee. */
async function seedEngagement(): Promise<{
  ctx: OrgContext;
  engagementId: string;
  orgId: string;
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
  return { ctx, engagementId, orgId };
}

/** Drive design_proposal -> survey (pay the deposit, confirm). */
async function toSurvey(ctx: OrgContext, engagementId: string): Promise<void> {
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  const confirmed = await executeTransition(ctx, {
    engagementId,
    trigger: 'confirmAndPayDeposit',
  });
  expect(confirmed.ok).toBe(true);
}

/** Drive survey -> concept_review (survey artifact, 2 concept options). */
async function toConceptReview(
  ctx: OrgContext,
  engagementId: string,
): Promise<void> {
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' }))
      .ok,
  ).toBe(true);
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'optionsReady' })).ok,
  ).toBe(true);
}

describe('getEngagementGatePreview — the payment gate at concept_review', () => {
  it('a blocking gate_a: forward trigger selectConcept, payment item with amountDue = shortfall', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);

    const preview = await getEngagementGatePreview(ctx, engagementId);
    expect(preview.primaryTrigger).toBe('selectConcept');
    expect(preview.allClear).toBe(false);
    expect(preview.items).toEqual([
      {
        guard: 'gateAInstallmentCleared',
        ok: false,
        code: 'gate_a_not_cleared',
        amountDue: '20000.0000',
      },
    ]);
  });

  it('a PARTIAL gate_a payment: amountDue shrinks to the remaining shortfall', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '12000' });

    const preview = await getEngagementGatePreview(ctx, engagementId);
    expect(preview.items[0]).toEqual({
      guard: 'gateAInstallmentCleared',
      ok: false,
      code: 'gate_a_not_cleared',
      amountDue: '8000.0000',
    });
    expect(preview.allClear).toBe(false);
  });

  it('gate_a fully paid: item ok, amountDue null, allClear true, primaryTrigger set', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);
    await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });

    const preview = await getEngagementGatePreview(ctx, engagementId);
    expect(preview.primaryTrigger).toBe('selectConcept');
    expect(preview.allClear).toBe(true);
    expect(preview.items).toEqual([
      {
        guard: 'gateAInstallmentCleared',
        ok: true,
        code: null,
        amountDue: null,
      },
    ]);
  });
});

describe('getEngagementGatePreview — a non-money guard carries no amountDue', () => {
  it('at survey: spatialBaseReady blocks with amountDue null (no survey recorded)', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);

    const preview = await getEngagementGatePreview(ctx, engagementId);
    expect(preview.primaryTrigger).toBe('spatialBaseReady');
    expect(preview.items).toEqual([
      {
        guard: 'spatialBaseReady',
        ok: false,
        code: 'spatial_base_missing',
        amountDue: null,
      },
    ]);
    expect(preview.allClear).toBe(false);
  });
});

describe('logPaymentAndAdvanceCore — sequential record-then-advance', () => {
  it('happy path: records the gate_a payment AND advances to negotiation', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'gate_a',
      amount: '20000',
      advanceTrigger: 'selectConcept',
    });
    expect(res.ok).toBe(true);
    expect(res.paymentRecorded).toBe(true);
    expect(await stateOf(engagementId)).toBe('negotiation');
    expect(await gateAPaymentCount(engagementId)).toBe(1);
  });

  it('fails safe: a SHORT payment persists but the state does NOT advance', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'gate_a',
      amount: '19999.9999',
      advanceTrigger: 'selectConcept',
    });
    expect(res).toMatchObject({
      ok: false,
      error: 'gate_a_not_cleared',
      paymentRecorded: true,
    });
    // The payment genuinely persisted; the state stayed put (guard re-checks).
    expect(await gateAPaymentCount(engagementId)).toBe(1);
    expect(await stateOf(engagementId)).toBe('concept_review');
  });

  it('rejects a terminal engagement (no payment, no advance)', async () => {
    const { ctx, engagementId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);
    // Force a terminal state (BYPASSRLS) — abandon is not yet wired via the machine.
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`,
    );

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'gate_a',
      amount: '20000',
      advanceTrigger: 'selectConcept',
    });
    expect(res).toMatchObject({
      ok: false,
      error: 'engagement_not_active',
      paymentRecorded: false,
    });
    expect(await gateAPaymentCount(engagementId)).toBe(0);
    expect(await stateOf(engagementId)).toBe('abandoned');
  });

  it('stays gated on the interior flow: flow_not_enabled, nothing recorded', async () => {
    const { ctx, engagementId, orgId } = await seedEngagement();
    await toSurvey(ctx, engagementId);
    await toConceptReview(ctx, engagementId);
    await setEnabledFlows(orgId, '{}');

    const res = await logPaymentAndAdvanceCore(ctx, engagementId, {
      paymentKind: 'gate_a',
      amount: '20000',
      advanceTrigger: 'selectConcept',
    });
    expect(res).toMatchObject({
      ok: false,
      error: 'flow_not_enabled',
      paymentRecorded: false,
    });
    // The reused payment core refused BEFORE any row — no gate_a receipt, no move.
    expect(await gateAPaymentCount(engagementId)).toBe(0);
    expect(await stateOf(engagementId)).toBe('concept_review');
  });
});
