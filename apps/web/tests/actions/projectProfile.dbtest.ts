import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { getProjectOverview } from '@/lib/projects/queries';
import { listStages } from '@/lib/project-stages/queries';
import { listActivities } from '@/lib/activities/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setup() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  return { orgId, ownerId: ownerIds[0], ctx, clientId: client.id };
}

async function makeProject(ctx: ReturnType<typeof ctxFor>, clientId: string) {
  const res = await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `PRJ-${Math.random().toString(36).slice(2, 7)}`,
    nameEn: 'Tower',
    clientId,
    status: 'active',
  });
  return (res as { data?: string }).data!;
}

describe('createProjectCore — seeds stages + project_created activity', () => {
  it('seeds 10 stages from the templates (in order) + one project_created activity', async () => {
    const { orgId, ownerId, ctx, clientId } = await setup();
    const id = await makeProject(ctx, clientId);
    expect(id).toBeTruthy();

    const stages = await listStages(ctx, id);
    expect(stages).toHaveLength(10);
    expect(stages[0].stageKey).toBe('design_drawings');
    expect(stages[9].stageKey).toBe('handover');
    expect(stages.every((s) => s.status === 'not_started')).toBe(true);

    const feed = await listActivities(ctx, 'project', id);
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('project_created');
    expect(feed[0].actorUserId).toBe(ownerId);
    void orgId;
  });

  it('rejects advance/retention outside [0,100]; DB CHECK rejects 150 (23514)', async () => {
    const { ctx, clientId } = await setup();
    expect(
      await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code: 'BAD-1', nameEn: 'x', clientId, status: 'active', advancePct: '150' }),
    ).toEqual({ ok: false, error: 'invalid' });

    const id = await makeProject(ctx, clientId);
    await expect(
      raw.query(`update public.projects set advance_pct = 150 where id = '${id}'`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('getProjectOverview — real figures; job-costing locked', () => {
  it('contractedTotal = sum(accepted totals); progress avg; current stage derived', async () => {
    const { orgId, ctx, clientId } = await setup();
    const id = await makeProject(ctx, clientId);

    await raw.query(
      `insert into public.proposals (id, org_id, number, title_en, client_id, project_id, status, total)
       values (gen_random_uuid(), '${orgId}', 7001, 'Accepted', '${clientId}', '${id}', 'accepted', 250.0000)`,
    );
    await raw.query(
      `insert into public.proposals (id, org_id, number, title_en, client_id, project_id, status, total)
       values (gen_random_uuid(), '${orgId}', 7002, 'Draft', '${clientId}', '${id}', 'draft', 999.0000)`,
    );

    const ov = await getProjectOverview(ctx, id);
    expect(ov.totalStages).toBe(10);
    expect(ov.doneStages).toBe(0);
    expect(ov.overallProgress).toBe(0);
    expect(Number(ov.contractedTotal)).toBe(250);
    // current stage of a fresh project = the first stage.
    expect(ov.currentStage?.stageKey).toBe('design_drawings');
    // Job-costing fields intentionally absent.
    expect('jobCost' in ov).toBe(false);
    expect('invoiced' in ov).toBe(false);
  });
});
