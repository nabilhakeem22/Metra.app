import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { setEngagementRomCore } from '@/lib/engagements/rom';
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

const FEE: GenerateFeeSchedulePayload = {
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

/**
 * Seed an org (owner + accountant + PM + site_engineer members) and drive ONE
 * engagement to `boq` via executeTransition only: the full wired walk through
 * approveDesign, then shop_drawing -> draftReady.
 */
async function setupBoq(): Promise<{
  orgId: string;
  ctx: OrgContext;
  memberIds: string[];
  engagementId: string;
}> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [
      { role: 'accountant' },
      { role: 'project_manager' },
      { role: 'site_engineer' },
    ],
  });
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
  });
  const engagementId = (created as { data?: string }).data!;
  await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: FEE,
  });
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' });
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await executeTransition(ctx, { engagementId, trigger: 'optionsReady' });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await executeTransition(ctx, { engagementId, trigger: 'selectConcept' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' });
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-alpha',
  });
  await executeTransition(ctx, { engagementId, trigger: 'rendersReady' });
  await setEngagementRomCore(ctx, {
    engagementId,
    romLow: '500000',
    romHigh: '800000',
  });
  await recordRomAcknowledgementCore(ctx, { engagementId });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
  await executeTransition(ctx, { engagementId, trigger: 'approveDesign' });
  await recordArtifactCore(ctx, { engagementId, kind: 'shop_drawing' });
  await executeTransition(ctx, { engagementId, trigger: 'draftReady' });
  expect(await stateOf(engagementId)).toBe('boq');
  return { orgId, ctx, memberIds, engagementId };
}

describe('finalizeBOQ — the BOQ gate (tail wiring, finance family)', () => {
  it('with NO boq artifact: boq_missing, no state move, no transition row', async () => {
    const { ctx, engagementId } = await setupBoq();

    const res = await executeTransition(ctx, { engagementId, trigger: 'finalizeBOQ' });
    expect(res).toEqual({ ok: false, error: 'boq_missing' });
    expect(await stateOf(engagementId)).toBe('boq');
    expect(await transitionCount(engagementId, 'finalizeBOQ')).toBe(0);
  });

  it('the shop_drawing already on file never counts; a recorded boq advances to execution_decision', async () => {
    const { ctx, engagementId } = await setupBoq();
    // The walk recorded a shop_drawing — it must not satisfy the BOQ gate
    // (verified by the boq_missing case above sharing the same walk); now the
    // real BOQ clears it.
    await recordArtifactCore(ctx, { engagementId, kind: 'boq', label: 'v1' });
    const res = await executeTransition(ctx, { engagementId, trigger: 'finalizeBOQ' });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('execution_decision');
    expect(await transitionCount(engagementId, 'finalizeBOQ')).toBe(1);
  });

  it('capability: the accountant CAN fire it; PM and site_engineer are forbidden (§2.2 finance row)', async () => {
    const { orgId, ctx, memberIds, engagementId } = await setupBoq();
    await recordArtifactCore(ctx, { engagementId, kind: 'boq' });

    const [accountantId, pmId, siteEngineerId] = memberIds;

    // PM / site_engineer: engagements_finance grants them NOTHING — rejected
    // before any DB work, no state move.
    expect(
      await executeTransition(ctxFor(orgId, pmId, 'project_manager'), {
        engagementId,
        trigger: 'finalizeBOQ',
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await executeTransition(ctxFor(orgId, siteEngineerId, 'site_engineer'), {
        engagementId,
        trigger: 'finalizeBOQ',
      }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(await stateOf(engagementId)).toBe('boq');
    expect(await transitionCount(engagementId, 'finalizeBOQ')).toBe(0);

    // The accountant (engagements_finance CRUA) fires it.
    const res = await executeTransition(ctxFor(orgId, accountantId, 'accountant'), {
      engagementId,
      trigger: 'finalizeBOQ',
    });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('execution_decision');
  });
});
