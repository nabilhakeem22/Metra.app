import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import {
  createContactCore,
  deleteContactCore,
  setPrimaryContactCore,
} from '@/lib/client-contacts/core';
import { listContacts } from '@/lib/client-contacts/queries';
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
  await createClientCore(ctx, { nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  return { orgId, ownerIds, memberIds, ctx, clientId: client.id };
}

const roleOf = async (orgId: string, uid: string) =>
  (await raw.memberships(orgId)).find((m) => m.user_id === uid)!.role as MemberRole;

describe('client_contacts — one primary + atomic swap', () => {
  it('the partial unique rejects a second primary (direct insert -> 23505)', async () => {
    const { orgId, ctx, clientId } = await setupClient();
    await createContactCore(ctx, { clientId, name: 'A', isPrimary: true });
    await expect(
      raw.query(
        `insert into public.client_contacts (id, org_id, client_id, name, is_primary)
         values (gen_random_uuid(), '${orgId}', '${clientId}', 'B', true)`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('creating a new primary demotes the old; setPrimary swaps atomically', async () => {
    const { ctx, clientId } = await setupClient();
    const a = await createContactCore(ctx, { clientId, name: 'A', isPrimary: true });
    const b = await createContactCore(ctx, { clientId, name: 'B', isPrimary: true });
    expect(a.ok && b.ok).toBe(true);
    let list = await listContacts(ctx, clientId);
    expect(list.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(list.find((c) => c.isPrimary)!.name).toBe('B'); // newest primary won

    // Swap back to A.
    const setRes = await setPrimaryContactCore(ctx, { id: a.data! });
    expect(setRes.ok).toBe(true);
    list = await listContacts(ctx, clientId);
    expect(list.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(list.find((c) => c.isPrimary)!.name).toBe('A');
  });

  it('deleting a primary contact -> last_primary_contact, deletes nothing', async () => {
    const { orgId, ctx, clientId } = await setupClient();
    const p = await createContactCore(ctx, { clientId, name: 'Primary', isPrimary: true });
    await createContactCore(ctx, { clientId, name: 'Secondary' });
    const res = await deleteContactCore(ctx, { id: p.data! });
    expect(res).toEqual({ ok: false, error: 'last_primary_contact' });
    expect(await raw.count('client_contacts', orgId)).toBe(2); // nothing deleted

    // A non-primary contact deletes fine.
    const [nonPrimary] = (await listContacts(ctx, clientId)).filter(
      (c) => !c.isPrimary,
    );
    expect((await deleteContactCore(ctx, { id: nonPrimary.id })).ok).toBe(true);
    expect(await raw.count('client_contacts', orgId)).toBe(1);
  });
});

describe('client_contacts — §2.2 gates (contact writes are manager-only)', () => {
  it('owner/admin/PM may create; site_engineer/accountant/viewer/client forbidden', async () => {
    const { orgId, ownerIds, memberIds, ctx, clientId } = await setupClient();
    // owner ok
    expect((await createContactCore(ctx, { clientId, name: 'O' })).ok).toBe(true);
    // PM ok, others forbidden
    for (const uid of memberIds) {
      const role = await roleOf(orgId, uid);
      const res = await createContactCore(ctxFor(orgId, uid, role), {
        clientId,
        name: 'X',
      });
      if (role === 'project_manager') {
        expect(res.ok, role).toBe(true);
      } else {
        expect(res, role).toEqual({ ok: false, error: 'forbidden' });
      }
    }
    void ownerIds;
  });
});
