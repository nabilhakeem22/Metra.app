import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore, updateClientCore } from '@/lib/clients/core';
import { getClientOverview } from '@/lib/clients/queries';
import { listClients } from '@/lib/clients/queries';
import { listActivities } from '@/lib/activities/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('client profile — type + advance/retention validation', () => {
  it('accepts a valid type + percentages', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const res = await createClientCore(ctx, {
      nameEn: 'Acme',
      type: 'consultant',
      advancePct: '25',
      retentionPct: '10',
    });
    expect(res.ok).toBe(true);
    const [c] = await listClients(ctx, {});
    expect(c.type).toBe('consultant');
    expect(c.advancePct).toBe('25.0000');
    expect(c.retentionPct).toBe('10.0000');
  });

  it('rejects advance/retention outside [0,100]', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'X' });
    const [c] = await listClients(ctx, {});
    expect(
      await updateClientCore(ctx, { id: c.id, nameEn: 'X', advancePct: '150' }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await updateClientCore(ctx, { id: c.id, nameEn: 'X', retentionPct: '-5' }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('DB CHECK independently rejects advance_pct = 150 (23514)', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Y' });
    const [c] = await listClients(ctx, {});
    await expect(
      raw.query(
        `update public.clients set advance_pct = 150 where id = '${c.id}'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('client profile — createClient appends a client_created activity', () => {
  it('records exactly one client_created activity', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Acme' });
    const [c] = await listClients(ctx, {});
    const feed = await listActivities(ctx, 'client', c.id);
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('client_created');
    expect(feed[0].actorUserId).toBe(ownerIds[0]);
  });
});

describe('getClientOverview — real counts + contracted total; invoicing locked', () => {
  it('contractedTotal = sum of accepted proposal totals; counts are real', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Acme' });
    const [client] = await listClients(ctx, {});
    await createProjectCore(ctx, {
      code: 'PRJ-1',
      nameEn: 'Tower',
      clientId: client.id,
      status: 'active',
    });
    const [project] = await listProjects(ctx, {});

    // Raw-insert proposals (BYPASSRLS): one accepted (total 100), one draft.
    await raw.query(
      `insert into public.proposals (id, org_id, number, title_en, client_id, project_id, status, total)
       values (gen_random_uuid(), '${orgId}', 5001, 'Accepted', '${client.id}', '${project.id}', 'accepted', 100.0000)`,
    );
    await raw.query(
      `insert into public.proposals (id, org_id, number, title_en, client_id, project_id, status, total)
       values (gen_random_uuid(), '${orgId}', 5002, 'Draft', '${client.id}', '${project.id}', 'draft', 999.0000)`,
    );

    const ov = await getClientOverview(ctx, client.id);
    expect(ov.projectCount).toBe(1);
    expect(ov.activeProposalCount).toBe(1); // the draft (accepted is terminal)
    expect(Number(ov.contractedTotal)).toBe(100);
    expect(ov.recentActivity.some((a) => a.kind === 'client_created')).toBe(true);
    // Invoiced/outstanding are intentionally absent (no demo numbers).
    expect('invoiced' in ov).toBe(false);
    expect('outstanding' in ov).toBe(false);
  });
});
