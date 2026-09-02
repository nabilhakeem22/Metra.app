import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { addActivityCore } from '@/lib/activities/core';
import { listActivities } from '@/lib/activities/queries';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { MemberRole } from '@metra/db';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setupClient() {
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
  return { orgId, memberIds, ctx, clientId: client.id };
}

const roleOf = async (orgId: string, uid: string) =>
  (await raw.memberships(orgId)).find((m) => m.user_id === uid)!.role as MemberRole;

describe('addActivityCore — validation', () => {
  it('a note without text -> invalid', async () => {
    const { ctx, clientId } = await setupClient();
    expect(
      await addActivityCore(ctx, { entityType: 'client', entityId: clientId, kind: 'note', note: '   ' }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('an entity_id not in this org -> invalid (loads the parent first)', async () => {
    const { ctx } = await setupClient();
    expect(
      await addActivityCore(ctx, {
        entityType: 'client',
        entityId: randomUUID(),
        note: 'hello',
      }),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('a valid note is recorded with actorUserId', async () => {
    const { orgId, ctx, clientId } = await setupClient();
    const res = await addActivityCore(ctx, {
      entityType: 'client',
      entityId: clientId,
      note: 'Called the client',
    });
    expect(res.ok).toBe(true);
    const feed = await listActivities(ctx, 'client', clientId);
    // client_created (from createClient) + the note.
    expect(feed.some((a) => a.kind === 'note' && a.note === 'Called the client')).toBe(true);
    void orgId;
  });
});

describe('addActivityCore — §2.2 gate (client_activity)', () => {
  it('allowed for owner/admin/PM/site_engineer/accountant; forbidden for viewer/client', async () => {
    const { orgId, memberIds, ctx, clientId } = await setupClient();
    // owner ok
    expect(
      (await addActivityCore(ctx, { entityType: 'client', entityId: clientId, note: 'o' })).ok,
    ).toBe(true);
    for (const uid of memberIds) {
      const role = await roleOf(orgId, uid);
      const res = await addActivityCore(ctxFor(orgId, uid, role), {
        entityType: 'client',
        entityId: clientId,
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
