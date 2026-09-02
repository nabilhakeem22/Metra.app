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
    const res = await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme', city: 'Cairo' });
    expect(res.ok).toBe(true);
    expect(await raw.count('clients', orgId)).toBe(1);
    expect(await raw.count('audit_log', orgId)).toBe(1);
  });

  it('rejects when no name is given', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect(
      await createClientCore(ctx, { phone: '01000000000', nameEn: '  ', nameAr: '' }),
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
      { phone: '01000000000', nameEn: 'PM Client' },
    );
    expect(pm.ok).toBe(true);

    for (const uid of memberIds.slice(1)) {
      const role = await roleOf(uid);
      const res = await createClientCore(ctxFor(orgId, uid, role as never), {
        phone: '01000000000',
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
    await createClientCore(ctx, { phone: '01000000000', nameEn: 'Before' });
    const [c] = await listClients(ctx, {});

    expect((await updateClientCore(ctx, { id: c.id, nameEn: 'After' })).ok).toBe(true);
    expect((await setClientActiveCore(ctx, { id: c.id, active: false })).ok).toBe(true);

    const [after] = await listClients(ctx, {});
    expect(after.nameEn).toBe('After');
    expect(after.active).toBe(false);
  });
});

describe('phone is required forward-only', () => {
  it('refuses to CREATE a client with no phone', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect(await createClientCore(ctx, { nameEn: 'No Phone Co' })).toEqual({
      ok: false,
      error: 'phone_required',
    });
    expect(await createClientCore(ctx, { nameEn: 'Blank', phone: '   ' })).toEqual({
      ok: false,
      error: 'phone_required',
    });
  });

  it('preserves a phone that the update simply does not mention', async () => {
    // The distinction that broke the first attempt: `normalized()` maps both an
    // OMITTED phone and an explicitly CLEARED one to null, so a partial save must
    // not be read as an attempt to blank it.
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Keeps Phone', phone: '01000000000' });
    const [client] = await listClients(ctx, {});

    expect(
      (await updateClientCore(ctx, { id: client.id, nameEn: 'Keeps Phone' })).ok,
    ).toBe(true);
    const [row] = await raw.query<{ phone: string | null }>(
      `select phone from public.clients where id = '${client.id}'`,
    );
    expect(row.phone).toBe('01000000000');
  });

  it('still lets a LEGACY client with no phone be edited', async () => {
    // 311 of the 315 clients in production predate this rule. If an edit demanded a
    // phone, almost every existing record would be uneditable — a firm could not fix
    // an address typo without inventing a phone number. This is the guard on that.
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Legacy', phone: '01000000000' });
    const [client] = await listClients(ctx, {});
    // Simulate a pre-rule row by blanking the phone directly.
    await raw.query(`update public.clients set phone = null where id = '${client.id}'`);

    const res = await updateClientCore(ctx, {
      id: client.id,
      nameEn: 'Legacy',
      city: 'Alexandria',
    });
    expect(res.ok).toBe(true);
  });

  it('refuses to BLANK a phone that is already set', async () => {
    // Forward-only tightening: the rule never loosens data that already complies.
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { nameEn: 'Has Phone', phone: '01000000000' });
    const [client] = await listClients(ctx, {});

    expect(
      await updateClientCore(ctx, { id: client.id, nameEn: 'Has Phone', phone: '' }),
    ).toEqual({ ok: false, error: 'phone_required' });
  });

  it('does NOT zero advance/retention when the form omits them', async () => {
    // The Details form stopped sending these when they moved to Financials. Without
    // the partial-update guard, every profile save would silently zero two columns
    // that Public API v1 still serves.
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, {
      nameEn: 'Rates Co',
      phone: '01000000000',
      advancePct: '25',
      retentionPct: '10',
    });
    const [client] = await listClients(ctx, {});

    // A save carrying NO percentages at all — exactly what the Details tab sends.
    expect(
      (await updateClientCore(ctx, { id: client.id, nameEn: 'Rates Co', city: 'Giza' }))
        .ok,
    ).toBe(true);

    const [row] = await raw.query<{ advance_pct: string; retention_pct: string }>(
      `select advance_pct, retention_pct from public.clients where id = '${client.id}'`,
    );
    expect(Number(row.advance_pct)).toBe(25);
    expect(Number(row.retention_pct)).toBe(10);
  });
});
