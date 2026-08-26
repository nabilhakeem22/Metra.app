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
  await createClientCore(ctx, { nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
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
    // the named index maps to `project_delivery_exists`.
    const [a, b] = await Promise.all([
      createEngagementCore(ctx, { titleEn: 'A', clientId, projectId }),
      createEngagementCore(ctx, { titleEn: 'B', clientId, projectId }),
    ]);

    const oks = [a, b].filter((r) => r.ok).length;
    const conflicts = [a, b].filter(
      (r) => !r.ok && r.error === 'project_delivery_exists',
    ).length;
    expect(oks).toBe(1);
    expect(conflicts).toBe(1);

    // The index is the real proof: exactly one active row survived the race.
    expect(await activeDeliveries(projectId)).toBe(1);
    expect(await totalDeliveries(projectId)).toBe(1);
  });
});

describe('two-delivery lifetime cap (Slice C2-hardening, abandoned excluded)', () => {
  it('a terminal delivery below the cap can start the project extension', async () => {
    const { ctx, clientId, projectId } = await setup();
    const first = await createEngagementCore(ctx, {
      titleEn: 'Original',
      clientId,
      projectId,
    });
    await setTerminal(idOf(first as { data?: string }), 'closed_design_only');

    // Non-abandoned count = 1 (< 2) → the one extension is allowed.
    const extension = await createEngagementCore(ctx, {
      titleEn: 'Extension',
      clientId,
      projectId,
    });
    expect(extension.ok).toBe(true);
    expect(await totalDeliveries(projectId)).toBe(2);
  });

  it('a project with two non-abandoned deliveries rejects a third, writing nothing', async () => {
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
    await setTerminal(idOf(second as { data?: string }), 'execution');
    expect(await totalDeliveries(projectId)).toBe(2);

    // Non-abandoned count = 2 → the cap check fails before allocating a number.
    const third = await createEngagementCore(ctx, {
      titleEn: 'Third',
      clientId,
      projectId,
    });
    expect(third).toEqual({
      ok: false,
      error: 'project_delivery_limit_reached',
    });
    // Nothing written on the project…
    expect(await totalDeliveries(projectId)).toBe(2);

    // …and no number was consumed: the next delivery on a fresh project takes the
    // sequential number after the two that exist (3), with no phantom gap.
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
    expect(Number(row.number)).toBe(3);
  });

  it('abandoned deliveries do not count: 1 real + 1 abandoned still allows a new one', async () => {
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
    await setTerminal(idOf(second as { data?: string }), 'closed_design_only');

    // Rows on project = 2, but non-abandoned count = 1 → a new create SUCCEEDS.
    expect(await totalDeliveries(projectId)).toBe(2);
    const third = await createEngagementCore(ctx, {
      titleEn: 'Extension despite abandoned',
      clientId,
      projectId,
    });
    expect(third.ok).toBe(true);
    expect(await totalDeliveries(projectId)).toBe(3);
  });

  it('two non-abandoned plus an abandoned: the third non-abandoned is still rejected', async () => {
    const { ctx, clientId, projectId } = await setup();
    // Abandon a throwaway FIRST (while the non-abandoned count is still 0) —
    // the cap would block creating it once two real deliveries already exist.
    const abandoned = await createEngagementCore(ctx, {
      titleEn: 'Abandoned extra',
      clientId,
      projectId,
    });
    await setTerminal(idOf(abandoned as { data?: string }), 'abandoned');
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
    await setTerminal(idOf(second as { data?: string }), 'execution');

    // Non-abandoned count = 2 (the abandoned row is ignored) → reject.
    const fourth = await createEngagementCore(ctx, {
      titleEn: 'Fourth',
      clientId,
      projectId,
    });
    expect(fourth).toEqual({
      ok: false,
      error: 'project_delivery_limit_reached',
    });
    expect(await totalDeliveries(projectId)).toBe(3);
  });
});
