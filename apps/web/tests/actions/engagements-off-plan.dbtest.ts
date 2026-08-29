import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { setEngagementOffPlanCore } from '@/lib/engagements/off-plan';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/**
 * Seed an org + client + project and create ONE engagement in `created`. Off-plan
 * defaults to false; the proposal window (`created` / `design_proposal`) is the
 * only place it may be flipped.
 */
async function setup(): Promise<{ ctx: OrgContext; engagementId: string }> {
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
  });
  const engagementId = (created as { data?: string }).data!;
  return { ctx, engagementId };
}

async function offPlanOf(engagementId: string): Promise<boolean> {
  const [row] = await raw.query<{ off_plan: boolean }>(
    `select off_plan from public.design_engagements where id = '${engagementId}'`,
  );
  return row.off_plan;
}

async function forceState(engagementId: string, state: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${engagementId}'`,
  );
}

describe('setEngagementOffPlan — proposal-window toggle', () => {
  it('flips off_plan in `created` and reads it back; state never moves', async () => {
    const { ctx, engagementId } = await setup();
    const res = await setEngagementOffPlanCore(ctx, { engagementId, offPlan: true });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await offPlanOf(engagementId)).toBe(true);
    const [row] = await raw.query<{ state: string }>(
      `select state from public.design_engagements where id = '${engagementId}'`,
    );
    expect(row.state).toBe('created');
  });

  it('flips back to false in `design_proposal` (still inside the window)', async () => {
    const { ctx, engagementId } = await setup();
    await setEngagementOffPlanCore(ctx, { engagementId, offPlan: true });
    await forceState(engagementId, 'design_proposal');
    const res = await setEngagementOffPlanCore(ctx, { engagementId, offPlan: false });
    expect(res.ok).toBe(true);
    expect(await offPlanOf(engagementId)).toBe(false);
  });

  it('rejects a flip in `survey` with off_plan_locked, writing nothing', async () => {
    const { ctx, engagementId } = await setup();
    // Past the proposal window: the flag has already fed the machine.
    await forceState(engagementId, 'survey');
    const res = await setEngagementOffPlanCore(ctx, { engagementId, offPlan: true });
    expect(res).toEqual({ ok: false, error: 'off_plan_locked' });
    // Unchanged from its false default — no partial write.
    expect(await offPlanOf(engagementId)).toBe(false);
  });

  it('rejects a flip on a terminal engagement with engagement_not_active', async () => {
    const { ctx, engagementId } = await setup();
    await forceState(engagementId, 'abandoned');
    const res = await setEngagementOffPlanCore(ctx, { engagementId, offPlan: true });
    expect(res).toEqual({ ok: false, error: 'engagement_not_active' });
    expect(await offPlanOf(engagementId)).toBe(false);
  });

  it('rejects a non-boolean input with invalid, writing nothing', async () => {
    const { ctx, engagementId } = await setup();
    const res = await setEngagementOffPlanCore(ctx, {
      engagementId,
      offPlan: 'yes' as unknown as boolean,
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(await offPlanOf(engagementId)).toBe(false);
  });
});

describe('setEngagementOffPlan — cross-org isolation', () => {
  it('org B cannot flip off_plan on org A’s engagement', async () => {
    const { engagementId: aEngagement } = await setup();

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    // B targets A's engagement -> engagement_not_found (RLS hides it).
    const res = await setEngagementOffPlanCore(ctxB, {
      engagementId: aEngagement,
      offPlan: true,
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    // A's flag is untouched.
    expect(await offPlanOf(aEngagement)).toBe(false);
  });
});
