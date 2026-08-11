import { afterAll, describe, expect, it } from 'vitest';
import {
  createClientCore,
  setClientActiveCore,
  updateClientCore,
} from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('createClientCore', () => {
  it('creates a client + audit', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const res = await createClientCore(ctx, { nameEn: 'Acme', city: 'Cairo' });
    expect(res.ok).toBe(true);
    expect(await raw.count('clients', orgId)).toBe(1);
    expect(await raw.count('audit_log', orgId)).toBe(1);
  });

  it('rejects when no name is given', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect(
      await createClientCore(ctx, { nameEn: '  ', nameAr: '' }),
    ).toEqual({ ok: false, error: 'name_required' });
  });

  it('lets a project_manager create, forbids site_engineer/accountant/viewer', async () => {
    const { orgId, memberIds } = await seedOrg({
      owners: 1,
      members: [
        { role: 'project_manager' },
        { role: 'site_engineer' },
        { role: 'accountant' },
        { role: 'viewer' },
      ],
    });
    orgIds.push(orgId);
    const roleOf = async (uid: string) =>
      (await raw.memberships(orgId)).find((m) => m.user_id === uid)!.role;

    const pm = await createClientCore(
      ctxFor(orgId, memberIds[0], 'project_manager'),
      { nameEn: 'PM Client' },
    );
    expect(pm.ok).toBe(true);

    for (const uid of memberIds.slice(1)) {
      const role = await roleOf(uid);
      const res = await createClientCore(ctxFor(orgId, uid, role as never), {
        nameEn: 'x',
      });
      expect(res, `role ${role}`).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await raw.count('clients', orgId)).toBe(1); // only the PM's
  });
});

describe('update + activate', () => {
  it('updates and toggles active', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Before' });
    const [c] = await listClients(ctx, {});

    expect((await updateClientCore(ctx, { id: c.id, nameEn: 'After' })).ok).toBe(true);
    expect((await setClientActiveCore(ctx, { id: c.id, active: false })).ok).toBe(true);

    const [after] = await listClients(ctx, {});
    expect(after.nameEn).toBe('After');
    expect(after.active).toBe(false);
  });
});
