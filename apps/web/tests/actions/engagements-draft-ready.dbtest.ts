import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { deriveCommandCard } from '@/lib/engagements/command-card';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
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

// The 4-milestone AMOUNT split (fee 100k): deposit 30k, gate_a 20k, gate_b 20k,
// balance 30k — the gate-b harness schedule.
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
 * Seed an org + client + project, create ONE engagement and drive it through the
 * full wired path to `shop_drawings` via executeTransition only (the gate-b
 * harness walk + acknowledgeRom + gate_b payment + approveDesign).
 */
async function setupShopDrawings(): Promise<{
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
  });
  const engagementId = (created as { data?: string }).data!;
  expect(
    (
      await executeTransition(ctx, {
        engagementId,
        trigger: 'submitDesignFee',
        payload: FEE,
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
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'rendersReady' })).ok,
  ).toBe(true);
  expect(
    (
      await setEngagementRomCore(ctx, {
        engagementId,
        romLow: '500000',
        romHigh: '800000',
      })
    ).ok,
  ).toBe(true);
  expect((await recordRomAcknowledgementCore(ctx, { engagementId })).ok).toBe(true);
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'approveDesign' })).ok,
  ).toBe(true);
  expect(await stateOf(engagementId)).toBe('shop_drawings');
  return { ctx, engagementId };
}

describe('draftReady — the shop-drawings gate (tail wiring)', () => {
  it('with NO shop_drawing artifact: shop_drawings_missing, no state move, no transition row', async () => {
    const { ctx, engagementId } = await setupShopDrawings();

    const res = await executeTransition(ctx, { engagementId, trigger: 'draftReady' });
    expect(res).toEqual({ ok: false, error: 'shop_drawings_missing' });
    expect(await stateOf(engagementId)).toBe('shop_drawings');
    expect(await transitionCount(engagementId, 'draftReady')).toBe(0);
  });

  it('a render/BOQ never counts; ONE shop_drawing advances to boq with one transition row', async () => {
    const { ctx, engagementId } = await setupShopDrawings();

    // A same-stage BOQ artifact must NOT satisfy the shop-drawings gate.
    await recordArtifactCore(ctx, { engagementId, kind: 'boq', label: 'early' });
    expect(
      await executeTransition(ctx, { engagementId, trigger: 'draftReady' }),
    ).toEqual({ ok: false, error: 'shop_drawings_missing' });

    await recordArtifactCore(ctx, {
      engagementId,
      kind: 'shop_drawing',
      label: 'wall sections',
    });
    const res = await executeTransition(ctx, { engagementId, trigger: 'draftReady' });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('boq');
    expect(await transitionCount(engagementId, 'draftReady')).toBe(1);
  });

  it('an active shop_drawings engagement previews primaryTrigger draftReady — blockedStudio, never closed', async () => {
    const { ctx, engagementId } = await setupShopDrawings();

    const preview = await getEngagementGatePreview(ctx, engagementId);
    expect(preview.primaryTrigger).toBe('draftReady');
    expect(preview.allClear).toBe(false);
    expect(preview.items).toEqual([
      {
        guard: 'shopDrawingsPresent',
        ok: false,
        code: 'shop_drawings_missing',
        amountDue: null,
      },
    ]);

    // The cockpit derivation: a studio blocker (upload the drawings), NOT the
    // closed-equivalent card the unwired tail used to collapse into.
    const view = deriveCommandCard(preview, { canAdvance: true, isTerminal: false });
    expect(view.mode).toBe('blockedStudio');
    expect(view.primaryBlocker).toBe('shopDrawingsPresent');

    // Once the drawing lands the same preview goes all-clear.
    await recordArtifactCore(ctx, { engagementId, kind: 'shop_drawing' });
    const cleared = await getEngagementGatePreview(ctx, engagementId);
    expect(cleared.primaryTrigger).toBe('draftReady');
    expect(cleared.allClear).toBe(true);
    expect(
      deriveCommandCard(cleared, { canAdvance: true, isTerminal: false }).mode,
    ).toBe('ready');
  });
});
