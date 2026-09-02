import { afterAll, describe, expect, it } from 'vitest';
import { addActivityCore } from '@/lib/activities/core';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { upsertProjectTypeCore } from '@/lib/project-types/core';
import { listProjectTypes } from '@/lib/project-types/queries';
import { listStageTemplates } from '@/lib/stage-templates/queries';
import type { MemberRole } from '@metra/db';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const roleOf = async (orgId: string, uid: string) =>
  (await raw.memberships(orgId)).find((m) => m.user_id === uid)!.role as MemberRole;

describe('project config — types + templates', () => {
  it('seedOrg starts with 5 types + 10 templates', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect((await listProjectTypes(ctx)).length).toBe(5);
    expect((await listStageTemplates(ctx)).length).toBe(10);
  });

  it('upsertProjectTypeCore is idempotent (same name, either language -> same id)', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const a = await upsertProjectTypeCore(ctx, { nameEn: 'Clinic' });
    const b = await upsertProjectTypeCore(ctx, { nameEn: '  clinic ' });
    expect(a.ok && b.ok).toBe(true);
    expect(b.data).toBe(a.data);
    expect((await listProjectTypes(ctx)).length).toBe(6); // 5 defaults + 1
  });

  it('config writes forbidden for site_engineer/accountant/viewer/client', async () => {
    const { orgId, memberIds } = await seedOrg({
      owners: 1,
      members: [
        { role: 'site_engineer' },
        { role: 'accountant' },
        { role: 'viewer' },
        { role: 'client' },
      ],
    });
    orgIds.push(orgId);
    for (const uid of memberIds) {
      const role = await roleOf(orgId, uid);
      const res = await upsertProjectTypeCore(ctxFor(orgId, uid, role), {
        nameEn: 'Nope',
      });
      expect(res, role).toEqual({ ok: false, error: 'forbidden' });
    }
  });
});

describe('project_activity gate (notes on a project)', () => {
  it('allowed for owner/PM/site_engineer/accountant; forbidden for viewer/client', async () => {
    const { orgId, ownerIds, memberIds } = await seedOrg({
      owners: 1,
      members: [
        { role: 'project_manager' },
        { role: 'site_engineer' },
        { role: 'accountant' },
        { role: 'viewer' },
        { role: 'client' },
      ],
    });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
    const [client] = await listClients(ctx, {});
    const projectId = (
      (await createProjectCore(ctx, {
        code: 'PRJ-CFG',
        nameEn: 'T',
        clientId: client.id,
        status: 'active',
      })) as { data?: string }
    ).data!;

    expect(
      (await addActivityCore(ctx, { entityType: 'project', entityId: projectId, note: 'o' })).ok,
    ).toBe(true);
    for (const uid of memberIds) {
      const role = await roleOf(orgId, uid);
      const res = await addActivityCore(ctxFor(orgId, uid, role), {
        entityType: 'project',
        entityId: projectId,
        note: 'hi',
      });
      if (role === 'viewer' || role === 'client') {
        expect(res, role).toEqual({ ok: false, error: 'forbidden' });
      } else {
        expect(res.ok, role).toBe(true);
      }
    }
  });
});
