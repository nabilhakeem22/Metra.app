import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { getEngagementByProject } from '@/lib/engagements/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Seed an org with one client + one project; return the ctx + their ids. */
async function setup(): Promise<{
  orgId: string;
  ctx: OrgContext;
  clientId: string;
  projectId: string;
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
  return { orgId, ctx, clientId: client.id, projectId: project.id };
}

/** Force a delivery into a terminal state (BYPASSRLS) — the machine's off-ramp. */
async function setTerminal(id: string, state: 'closed_design_only' | 'execution' | 'abandoned') {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${id}'`,
  );
}

function idOf(res: { data?: string }): string {
  return res.data!;
}

async function deliveryCount(projectId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.design_engagements where project_id = '${projectId}'`,
  );
  return Number(row.n);
}

describe('getEngagementByProject (through-project read, Slice C2)', () => {
  it('returns null when the project has no delivery', async () => {
    const { ctx, projectId } = await setup();
    expect(await getEngagementByProject(ctx, projectId)).toBeNull();
  });

  it('returns the ACTIVE delivery when one exists', async () => {
    const { ctx, clientId, projectId } = await setup();
    const created = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    const id = idOf(created as { data?: string });

    const summary = await getEngagementByProject(ctx, projectId);
    expect(summary).not.toBeNull();
    expect(summary!.id).toBe(id);
    expect(summary!.state).toBe('created');
    expect(summary!.titleEn).toBe('Villa fit-out');
    expect(typeof summary!.createdAt).toBe('string');
  });

  it('returns the newest TERMINAL delivery when the project has only terminal ones', async () => {
    const { ctx, clientId, projectId } = await setup();
    const created = await createEngagementCore(ctx, {
      titleEn: 'Closed job',
      clientId,
      projectId,
    });
    const id = idOf(created as { data?: string });
    await setTerminal(id, 'closed_design_only');

    const summary = await getEngagementByProject(ctx, projectId);
    expect(summary).not.toBeNull();
    expect(summary!.id).toBe(id);
    expect(summary!.state).toBe('closed_design_only');
  });

  it('prefers the ACTIVE delivery over an older terminal one', async () => {
    const { ctx, clientId, projectId } = await setup();
    const first = await createEngagementCore(ctx, {
      titleEn: 'First (abandoned)',
      clientId,
      projectId,
    });
    await setTerminal(idOf(first as { data?: string }), 'abandoned');
    const second = await createEngagementCore(ctx, {
      titleEn: 'Second (active)',
      clientId,
      projectId,
    });
    const activeId = idOf(second as { data?: string });

    const summary = await getEngagementByProject(ctx, projectId);
    expect(summary!.id).toBe(activeId);
    expect(summary!.state).toBe('created');
  });

  it('cross-org: a foreign project reads as null', async () => {
    const a = await setup();
    const b = await setup();
    await createEngagementCore(b.ctx, {
      titleEn: 'B secret',
      clientId: b.clientId,
      projectId: b.projectId,
    });
    // Under org A, org B's project is invisible (RLS + membership second factor).
    expect(await getEngagementByProject(a.ctx, b.projectId)).toBeNull();
  });
});

describe('one-delivery-per-project guard (Slice C2)', () => {
  it('a second delivery on a project with a non-terminal one fails and writes nothing', async () => {
    const { ctx, clientId, projectId } = await setup();
    const first = await createEngagementCore(ctx, {
      titleEn: 'First',
      clientId,
      projectId,
    });
    expect(first.ok).toBe(true);
    expect(await deliveryCount(projectId)).toBe(1);

    const second = await createEngagementCore(ctx, {
      titleEn: 'Second',
      clientId,
      projectId,
    });
    expect(second).toEqual({ ok: false, error: 'project_delivery_exists' });
    // Nothing written: still exactly one delivery on the project.
    expect(await deliveryCount(projectId)).toBe(1);
  });

  it('a project whose only delivery is terminal can start a fresh one', async () => {
    const { ctx, clientId, projectId } = await setup();
    const first = await createEngagementCore(ctx, {
      titleEn: 'Old',
      clientId,
      projectId,
    });
    await setTerminal(idOf(first as { data?: string }), 'execution');

    const fresh = await createEngagementCore(ctx, {
      titleEn: 'New',
      clientId,
      projectId,
    });
    expect(fresh.ok).toBe(true);
    expect(await deliveryCount(projectId)).toBe(2);
  });
});
