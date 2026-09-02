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
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Client One' });
  const [client] = await listClients(ctx, {});
  return { orgId, ctx, clientId: client.id };
}

const baseProject = (clientId: string) => ({
  code: 'P-1',
  nameEn: 'Tower fit-out',
  clientId,
  status: 'draft' as const,
  // Required on create since the projects spec ("for good tracking").
  startDate: '2026-01-01',
  endDate: '2026-06-30',
});

describe('createProjectCore', () => {
  it('creates a project referencing an active client + audit', async () => {
    const { orgId, ctx, clientId } = await orgWithClient();
    const res = await createProjectCore(ctx, baseProject(clientId));
    expect(res.ok).toBe(true);
    expect(await raw.count('projects', orgId)).toBe(1);
  });

  it('validates name_required / invalid status / client_required / invalid_dates', async () => {
    const { ctx, clientId } = await orgWithClient();
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
    await createClientCore(owner, { phone: '01000000000', nameEn: 'Shared client' });
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

describe('auto-generated project codes', () => {
  it('allocates P-YYYY-NNNN when the caller supplies no code', async () => {
    const { ctx, clientId } = await orgWithClient();
    const { code: _code, ...noCode } = baseProject(clientId);
    expect((await createProjectCore(ctx, noCode)).ok).toBe(true);

    const [project] = await listProjects(ctx, {});
    const year = new Date().getFullYear();
    expect(project.code).toBe(`P-${year}-0001`);
  });

  it('increments per org, and two orgs never collide', async () => {
    const a = await orgWithClient();
    const b = await orgWithClient();
    const year = new Date().getFullYear();

    for (let i = 0; i < 3; i += 1) {
      const { code: _code, ...noCode } = baseProject(a.clientId);
      expect((await createProjectCore(a.ctx, noCode)).ok).toBe(true);
    }
    const { code: _bCode, ...bNoCode } = baseProject(b.clientId);
    expect((await createProjectCore(b.ctx, bNoCode)).ok).toBe(true);

    const codesA = (await listProjects(a.ctx, {})).map((p) => p.code).sort();
    expect(codesA).toEqual([`P-${year}-0001`, `P-${year}-0002`, `P-${year}-0003`]);
    // Org B starts its OWN sequence at 1 — the allocator is per-org.
    expect((await listProjects(b.ctx, {}))[0].code).toBe(`P-${year}-0001`);
  });

  it('still honours a caller-supplied code (imports, the Public API)', async () => {
    const { ctx, clientId } = await orgWithClient();
    expect(
      (await createProjectCore(ctx, { ...baseProject(clientId), code: 'LEGACY-7' })).ok,
    ).toBe(true);
    expect((await listProjects(ctx, {}))[0].code).toBe('LEGACY-7');
  });
});

describe('dates are required forward-only', () => {
  it('refuses to CREATE without both dates', async () => {
    const { ctx, clientId } = await orgWithClient();
    const { startDate: _s, endDate: _e, ...noDates } = baseProject(clientId);
    expect(await createProjectCore(ctx, noDates)).toEqual({
      ok: false,
      error: 'dates_required',
    });
    expect(await createProjectCore(ctx, { ...noDates, startDate: '2026-01-01' })).toEqual(
      { ok: false, error: 'dates_required' },
    );
  });

  it('still lets a LEGACY dateless project be edited', async () => {
    // 301 of the 307 projects in production have neither date. Demanding them on
    // update would make almost every existing project uneditable.
    const { ctx, clientId } = await orgWithClient();
    expect((await createProjectCore(ctx, baseProject(clientId))).ok).toBe(true);
    const [project] = await listProjects(ctx, {});
    await raw.query(
      `update public.projects set start_date = null, end_date = null where id = '${project.id}'`,
    );

    const res = await updateProjectCore(ctx, {
      id: project.id,
      code: project.code,
      nameEn: 'Tower fit-out',
      clientId,
      status: 'active',
    });
    expect(res.ok).toBe(true);
  });

  it('does NOT zero advance/retention when the form omits them', async () => {
    const { ctx, clientId } = await orgWithClient();
    expect(
      (await createProjectCore(ctx, {
        ...baseProject(clientId),
        advancePct: '20',
        retentionPct: '5',
      })).ok,
    ).toBe(true);
    const [project] = await listProjects(ctx, {});

    expect(
      (await updateProjectCore(ctx, {
        id: project.id,
        code: project.code,
        nameEn: 'Tower fit-out',
        clientId,
        status: 'active',
      })).ok,
    ).toBe(true);

    const [row] = await raw.query<{ advance_pct: string; retention_pct: string }>(
      `select advance_pct, retention_pct from public.projects where id = '${project.id}'`,
    );
    expect(Number(row.advance_pct)).toBe(20);
    expect(Number(row.retention_pct)).toBe(5);
  });
});

describe('the plan project cap', () => {
  it('is UNLIMITED when no limit is configured', async () => {
    // The state every production workspace is in. Must not block anything.
    const { ctx, clientId } = await orgWithClient();
    for (let i = 0; i < 3; i += 1) {
      const { code: _code, ...noCode } = baseProject(clientId);
      expect((await createProjectCore(ctx, noCode)).ok).toBe(true);
    }
  });

  it('refuses the seat past a configured limit', async () => {
    const { orgId, ctx, clientId } = await orgWithClient();
    await raw.query(
      `update public.workspace_entitlements set limits = '{"projects": 2}'::jsonb
       where org_id = '${orgId}'`,
    );
    const make = () => {
      const { code: _code, ...noCode } = baseProject(clientId);
      return createProjectCore(ctx, noCode);
    };
    expect((await make()).ok).toBe(true);
    expect((await make()).ok).toBe(true);
    expect(await make()).toEqual({ ok: false, error: 'project_limit_reached' });
    expect(await raw.count('projects', orgId)).toBe(2);
  });
});
