import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { getDeliveriesByProjects } from '@/lib/engagements/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Seed an org with one client; return the ctx + the client id. */
async function setupOrg(): Promise<{
  orgId: string;
  ctx: OrgContext;
  clientId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  return { orgId, ctx, clientId: client.id };
}

/** Create a project under a ctx and return its id. */
async function addProject(
  ctx: OrgContext,
  clientId: string,
  code: string,
): Promise<string> {
  await createProjectCore(ctx, {
    code,
    nameEn: `Project ${code}`,
    clientId,
    status: 'active',
  });
  const projects = await listProjects(ctx, {});
  return projects.find((p) => p.code === code)!.id;
}

/** Force a delivery into a terminal state (BYPASSRLS) — the machine's off-ramp. */
async function setTerminal(
  id: string,
  state: 'closed_design_only' | 'execution' | 'abandoned',
) {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${id}'`,
  );
}

function idOf(res: { data?: string }): string {
  return res.data!;
}

describe('getDeliveriesByProjects (batch through-project read, Slice C4)', () => {
  it('returns {} for empty input', async () => {
    const { ctx } = await setupOrg();
    expect(await getDeliveriesByProjects(ctx, [])).toEqual({});
  });

  it('maps none/active/terminal/mixed projects in one read', async () => {
    const { ctx, clientId } = await setupOrg();
    const orgTag = clientId.slice(0, 6);

    // (a) a project with NO delivery
    const noneId = await addProject(ctx, clientId, `NONE-${orgTag}`);

    // (b) a project with a single ACTIVE delivery
    const activeId = await addProject(ctx, clientId, `ACTV-${orgTag}`);
    const activeDelivery = idOf(
      (await createEngagementCore(ctx, {
        titleEn: 'Active job',
        clientId,
        projectId: activeId,
      })) as { data?: string },
    );

    // (c) a project whose only delivery is TERMINAL
    const terminalId = await addProject(ctx, clientId, `TERM-${orgTag}`);
    const terminalDelivery = idOf(
      (await createEngagementCore(ctx, {
        titleEn: 'Closed job',
        clientId,
        projectId: terminalId,
      })) as { data?: string },
    );
    await setTerminal(terminalDelivery, 'closed_design_only');

    // (d) MIXED: an older terminal delivery + a newer ACTIVE one (active-preferred)
    const mixedId = await addProject(ctx, clientId, `MIXD-${orgTag}`);
    const oldTerminal = idOf(
      (await createEngagementCore(ctx, {
        titleEn: 'Old (abandoned)',
        clientId,
        projectId: mixedId,
      })) as { data?: string },
    );
    await setTerminal(oldTerminal, 'abandoned');
    const newActive = idOf(
      (await createEngagementCore(ctx, {
        titleEn: 'New (active)',
        clientId,
        projectId: mixedId,
      })) as { data?: string },
    );

    const map = await getDeliveriesByProjects(ctx, [
      noneId,
      activeId,
      terminalId,
      mixedId,
    ]);

    // Every requested project is a key; the delivery-less one maps to null.
    expect(Object.keys(map).sort()).toEqual(
      [noneId, activeId, terminalId, mixedId].sort(),
    );
    expect(map[noneId]).toBeNull();

    expect(map[activeId]!.id).toBe(activeDelivery);
    expect(map[activeId]!.state).toBe('created');
    expect(typeof map[activeId]!.createdAt).toBe('string');

    expect(map[terminalId]!.id).toBe(terminalDelivery);
    expect(map[terminalId]!.state).toBe('closed_design_only');

    // Active-preferred over the older terminal one.
    expect(map[mixedId]!.id).toBe(newActive);
    expect(map[mixedId]!.state).toBe('created');
  });

  it('cross-org: a foreign project reads as null (RLS + membership second factor)', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    const bProject = await addProject(b.ctx, b.clientId, `BONLY-${b.clientId.slice(0, 6)}`);
    await createEngagementCore(b.ctx, {
      titleEn: 'B secret',
      clientId: b.clientId,
      projectId: bProject,
    });

    // Under org A, org B's project is invisible: present as a key but null (no leak).
    const map = await getDeliveriesByProjects(a.ctx, [bProject]);
    expect(map[bProject]).toBeNull();
  });
});
