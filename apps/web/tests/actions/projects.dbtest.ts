import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore, setClientActiveCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import {
  createProjectCore,
  updateProjectCore,
} from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function orgWithClient() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Client One' });
  const [client] = await listClients(ctx, {});
  return { orgId, ctx, clientId: client.id };
}

const baseProject = (clientId: string) => ({
  code: 'P-1',
  nameEn: 'Tower fit-out',
  clientId,
  status: 'draft' as const,
});

describe('createProjectCore', () => {
  it('creates a project referencing an active client + audit', async () => {
    const { orgId, ctx, clientId } = await orgWithClient();
    const res = await createProjectCore(ctx, baseProject(clientId));
    expect(res.ok).toBe(true);
    expect(await raw.count('projects', orgId)).toBe(1);
  });

  it('validates code_required / name_required / invalid status / client_required / invalid_dates', async () => {
    const { ctx, clientId } = await orgWithClient();
    expect(
      await createProjectCore(ctx, { ...baseProject(clientId), code: ' ' }),
    ).toEqual({ ok: false, error: 'code_required' });
    expect(
      await createProjectCore(ctx, {
        ...baseProject(clientId),
        nameEn: '',
        nameAr: '',
      }),
    ).toEqual({ ok: false, error: 'name_required' });
    expect(
      await createProjectCore(ctx, {
        ...baseProject(clientId),
        status: 'nope' as never,
      }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await createProjectCore(ctx, { ...baseProject(clientId), clientId: '' }),
    ).toEqual({ ok: false, error: 'client_required' });
    expect(
      await createProjectCore(ctx, {
        ...baseProject(clientId),
        startDate: '2026-05-01',
        endDate: '2026-04-01',
      }),
    ).toEqual({ ok: false, error: 'invalid_dates' });
  });

  it('rejects a duplicate code with code_taken', async () => {
    const { ctx, clientId } = await orgWithClient();
    await createProjectCore(ctx, baseProject(clientId));
    expect(await createProjectCore(ctx, baseProject(clientId))).toEqual({
      ok: false,
      error: 'code_taken',
    });
  });

  it('rejects a missing or inactive client with client_required', async () => {
    const { ctx, clientId } = await orgWithClient();
    // Unknown client id.
    expect(
      await createProjectCore(ctx, {
        ...baseProject(clientId),
        clientId: '00000000-0000-4000-8000-000000000999',
      }),
    ).toEqual({ ok: false, error: 'client_required' });

    // Deactivate the client -> now unusable.
    await setClientActiveCore(ctx, { id: clientId, active: false });
    expect(
      await createProjectCore(ctx, { ...baseProject(clientId), code: 'P-2' }),
    ).toEqual({ ok: false, error: 'client_required' });
  });

  it('lets a project_manager create, forbids site_engineer/accountant/viewer', async () => {
    const { orgId, ownerIds } = await seedOrg({
      owners: 1,
      members: [
        { role: 'project_manager' },
        { role: 'site_engineer' },
        { role: 'accountant' },
        { role: 'viewer' },
      ],
    });
    orgIds.push(orgId);
    const owner = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(owner, { nameEn: 'Shared client' });
    const [client] = await listClients(owner, {});

    const pmCtx: OrgContext = ctxFor(orgId, (await raw.memberships(orgId)).find((m) => m.role === 'project_manager')!.user_id, 'project_manager');
    expect((await createProjectCore(pmCtx, baseProject(client.id))).ok).toBe(true);

    for (const role of ['site_engineer', 'accountant', 'viewer'] as const) {
      const uid = (await raw.memberships(orgId)).find((m) => m.role === role)!.user_id;
      const res = await createProjectCore(ctxFor(orgId, uid, role), {
        ...baseProject(client.id),
        code: `X-${role}`,
      });
      expect(res, role).toEqual({ ok: false, error: 'forbidden' });
    }
  });
});

describe('updateProjectCore', () => {
  it('updates status', async () => {
    const { ctx, clientId } = await orgWithClient();
    await createProjectCore(ctx, baseProject(clientId));
    const [p] = await listProjects(ctx, {});
    const res = await updateProjectCore(ctx, {
      id: p.id,
      ...baseProject(clientId),
      status: 'active',
    });
    expect(res.ok).toBe(true);
    const [after] = await listProjects(ctx, {});
    expect(after.status).toBe('active');
  });

  // F1: editing a project whose client was later archived must still succeed as
  // long as the client isn't being reassigned.
  it('allows editing a project whose (unchanged) client is now archived', async () => {
    const { ctx, clientId } = await orgWithClient();
    await createProjectCore(ctx, baseProject(clientId));
    const [p] = await listProjects(ctx, {});

    await setClientActiveCore(ctx, { id: clientId, active: false });

    const res = await updateProjectCore(ctx, {
      id: p.id,
      ...baseProject(clientId),
      status: 'completed',
    });
    expect(res).toEqual({ ok: true });

    const [after] = await listProjects(ctx, {});
    expect(after.status).toBe('completed');
  });
});

describe('date + client-id edge cases', () => {
  // F3: non-zero-padded dates order chronologically, not lexically.
  it('accepts non-zero-padded start/end dates in order', async () => {
    const { ctx, clientId } = await orgWithClient();
    const res = await createProjectCore(ctx, {
      ...baseProject(clientId),
      startDate: '2026-9-01',
      endDate: '2026-10-01',
    });
    expect(res.ok).toBe(true);
  });

  // F2: a malformed (non-UUID) client id -> client_required, no DB uuid-cast.
  it('rejects a malformed client id with client_required', async () => {
    const { ctx } = await orgWithClient();
    const res = await createProjectCore(ctx, {
      ...baseProject('not-a-uuid'),
      code: 'BADUUID',
    });
    expect(res).toEqual({ ok: false, error: 'client_required' });
  });
});
