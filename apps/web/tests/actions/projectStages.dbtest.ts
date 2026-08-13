import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { getProjectOverview } from '@/lib/projects/queries';
import {
  addStageCore,
  deleteStageCore,
  updateStageCore,
} from '@/lib/project-stages/core';
import { listStages } from '@/lib/project-stages/queries';
import type { MemberRole } from '@metra/db';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setup(members: Array<{ role: MemberRole }> = []) {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  const id = (
    (await createProjectCore(ctx, {
      code: `PRJ-${Math.random().toString(36).slice(2, 7)}`,
      nameEn: 'Tower',
      clientId: client.id,
      status: 'active',
    })) as { data?: string }
  ).data!;
  return { orgId, ctx, memberIds, projectId: id };
}

const roleOf = async (orgId: string, uid: string) =>
  (await raw.memberships(orgId)).find((m) => m.user_id === uid)!.role as MemberRole;

describe('project stages — start from any phase (no linear guard)', () => {
  it('mark stages 1-4 done/skipped + 5 in_progress -> overview current = stage 5', async () => {
    const { ctx, projectId } = await setup();
    const stages = await listStages(ctx, projectId);
    // 1,2 done ; 3,4 skipped ; 5 in_progress
    await updateStageCore(ctx, { id: stages[0].id, status: 'done', progressPct: '100' });
    await updateStageCore(ctx, { id: stages[1].id, status: 'done', progressPct: '100' });
    await updateStageCore(ctx, { id: stages[2].id, status: 'skipped' });
    await updateStageCore(ctx, { id: stages[3].id, status: 'skipped' });
    await updateStageCore(ctx, { id: stages[4].id, status: 'in_progress', progressPct: '40' });

    const ov = await getProjectOverview(ctx, projectId);
    expect(ov.currentStage?.id).toBe(stages[4].id);
    expect(ov.currentStage?.stageKey).toBe('flooring_tiling');
    expect(ov.doneStages).toBe(2);
  });

  it('derives current = first non-done/non-skipped when nothing is in_progress', async () => {
    const { ctx, projectId } = await setup();
    const stages = await listStages(ctx, projectId);
    await updateStageCore(ctx, { id: stages[0].id, status: 'done' });
    await updateStageCore(ctx, { id: stages[1].id, status: 'skipped' });
    const ov = await getProjectOverview(ctx, projectId);
    expect(ov.currentStage?.id).toBe(stages[2].id);
  });
});

describe('project stages — progress bounds', () => {
  it('addStage/updateStage reject progress outside [0,100] -> invalid_percentage', async () => {
    const { ctx, projectId } = await setup();
    expect(
      await addStageCore(ctx, { projectId, nameEn: 'Extra', progressPct: '150' }),
    ).toEqual({ ok: false, error: 'invalid_percentage' });
    const [s0] = await listStages(ctx, projectId);
    expect(
      await updateStageCore(ctx, { id: s0.id, progressPct: '-5' }),
    ).toEqual({ ok: false, error: 'invalid_percentage' });
  });

  it('DB CHECK independently rejects progress_pct = 150 (23514)', async () => {
    const { ctx, projectId } = await setup();
    const [s0] = await listStages(ctx, projectId);
    await expect(
      raw.query(`update public.project_stages set progress_pct = 150 where id = '${s0.id}'`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('add + delete a stage', async () => {
    const { orgId, ctx, projectId } = await setup();
    const res = await addStageCore(ctx, { projectId, nameEn: 'Custom', status: 'in_progress', progressPct: '10' });
    expect(res.ok).toBe(true);
    expect(await raw.count('project_stages', orgId)).toBe(11);
    expect((await deleteStageCore(ctx, { id: res.data! })).ok).toBe(true);
    expect(await raw.count('project_stages', orgId)).toBe(10);
  });
});

describe('project stages — §2.2 gate (config writes = projects/update)', () => {
  it('owner/PM may add; site_engineer/accountant/viewer/client forbidden', async () => {
    const { orgId, ctx, memberIds, projectId } = await setup([
      { role: 'project_manager' },
      { role: 'site_engineer' },
      { role: 'accountant' },
      { role: 'viewer' },
      { role: 'client' },
    ]);
    expect((await addStageCore(ctx, { projectId, nameEn: 'O' })).ok).toBe(true);
    for (const uid of memberIds) {
      const role = await roleOf(orgId, uid);
      const res = await addStageCore(ctxFor(orgId, uid, role), {
        projectId,
        nameEn: 'X',
      });
      if (role === 'project_manager') {
        expect(res.ok, role).toBe(true);
      } else {
        expect(res, role).toEqual({ ok: false, error: 'forbidden' });
      }
    }
  });
});
