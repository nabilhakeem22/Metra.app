import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
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

/** Add a second project to an org and return its id. */
async function addProject(
  ctx: OrgContext,
  clientId: string,
  suffix: string,
): Promise<string> {
  const res = await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `PRJ${suffix}-${ctx.orgId.slice(0, 8)}`,
    nameEn: `Tower ${suffix}`,
    clientId,
    status: 'active',
  });
  return (res as { data?: string }).data!;
}

/** Force a delivery into a terminal state (BYPASSRLS) — the machine's off-ramp. */
async function setTerminal(
  id: string,
  state: 'closed_design_only' | 'execution' | 'abandoned',
): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${id}'`,
  );
}

function idOf(res: { data?: string }): string {
  return res.data!;
}

/** Total delivery rows on a project (BYPASSRLS — every state). */
async function totalDeliveries(projectId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.design_engagements where project_id = '${projectId}'`,
  );
  return Number(row.n);
}

/** Active (non-terminal) delivery rows on a project (BYPASSRLS). */
async function activeDeliveries(projectId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.design_engagements
     where project_id = '${projectId}'
       and state not in ('closed_design_only', 'execution', 'abandoned')`,
  );
  return Number(row.n);
}

describe('one-active-delivery backstop (Slice C2-hardening)', () => {
  it('two concurrent creates on an empty project: exactly one wins, one active row remains', async () => {
    const { ctx, clientId, projectId } = await setup();

    // Both creates pass the read-guard (empty project) and contend on the partial
    // unique index (migration 0032). Exactly one INSERT wins; the other's 23505 on
    // the named index maps to `project_delivery_exists` under the project.
    const [a, b] = await Promise.all([
      createEngagementCore(ctx, { titleEn: 'A', clientId, projectId }),
      createEngagementCore(ctx, { titleEn: 'B', clientId, projectId }),
    ]);

    const oks = [a, b].filter((r) => r.ok).length;
    const conflicts = [a, b].filter(
      (r) => !r.ok && r.fields?.projectId?.code === 'project_delivery_exists',
    ).length;
    expect(oks).toBe(1);
    expect(conflicts).toBe(1);

    // The index is the real proof: exactly one active row survived the race.
    expect(await activeDeliveries(projectId)).toBe(1);
    expect(await totalDeliveries(projectId)).toBe(1);
  });
});

describe('one delivery per client per project (OD-1, abandoned excluded)', () => {
  it('a finished delivery refuses a second one, writing nothing and spending no number', async () => {
    const { ctx, clientId, projectId } = await setup();
    const first = await createEngagementCore(ctx, {
      titleEn: 'Original',
      clientId,
      projectId,
    });
    await setTerminal(idOf(first as { data?: string }), 'closed_design_only');

    const second = await createEngagementCore(ctx, {
      titleEn: 'Extension',
      clientId,
      projectId,
    });
    expect(second).toMatchObject({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'project_client_has_delivery' } },
    });
    // Nothing written on the project...
    expect(await totalDeliveries(projectId)).toBe(1);

    // ...and no number was consumed: the next delivery on a fresh project takes the
    // sequential number after the one that exists (2), with no phantom gap.
    const otherProjectId = await addProject(ctx, clientId, '2');
    const fresh = await createEngagementCore(ctx, {
      titleEn: 'Fresh',
      clientId,
      projectId: otherProjectId,
    });
    expect(fresh.ok).toBe(true);
    const [row] = await raw.query<{ number: number }>(
      `select number from public.design_engagements where id = '${idOf(
        fresh as { data?: string },
      )}'`,
    );
    expect(Number(row.number)).toBe(2);
  });

  it('abandoned deliveries do not count: a new one starts after them, and it then holds the slot', async () => {
    const { ctx, clientId, projectId } = await setup();
    const first = await createEngagementCore(ctx, {
      titleEn: 'Abandoned attempt',
      clientId,
      projectId,
    });
    await setTerminal(idOf(first as { data?: string }), 'abandoned');
    const second = await createEngagementCore(ctx, {
      titleEn: 'Real one',
      clientId,
      projectId,
    });
    expect(second.ok).toBe(true);
    await setTerminal(idOf(second as { data?: string }), 'execution');

    expect(await totalDeliveries(projectId)).toBe(2);
    const third = await createEngagementCore(ctx, {
      titleEn: 'A second link',
      clientId,
      projectId,
    });
    expect(third).toMatchObject({ fields: { projectId: { code: 'project_client_has_delivery' } } });
    expect(await totalDeliveries(projectId)).toBe(2);
  });
});
