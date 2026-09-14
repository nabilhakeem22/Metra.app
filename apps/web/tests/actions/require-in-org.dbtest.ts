import { afterAll, describe, expect, it } from 'vitest';
import { clients } from '@metra/db';
import { requireInOrg } from '@/lib/actions/mutate';
import { ActionError } from '@/lib/actions/result';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// requireInOrg deliberately carries NO org predicate: the RLS transaction is the
// tenancy boundary, and a row belonging to another tenant is simply invisible to
// the SELECT. That is a claim about Postgres, not about TypeScript, so it is
// proved here rather than in the unit test — and it is the claim on which all
// thirty-six adoption sites rest.

async function seedClient(name: string): Promise<{ ctx: OrgContext; clientId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: name });
  const [client] = await listClients(ctx, {});
  return { ctx, clientId: client.id };
}

describe('requireInOrg — the RLS transaction is the boundary', () => {
  it('returns the row for its own org', async () => {
    const { ctx, clientId } = await seedClient('Acme');
    const row = await withOrgContext(ctx, (tx) =>
      requireInOrg(tx, clients, clientId, { id: clients.id, nameEn: clients.nameEn }, 'invalid'),
    );
    expect(row).toEqual({ id: clientId, nameEn: 'Acme' });
  });

  it("refuses ANOTHER tenant's id with the caller's code, not a leak and not a throw", async () => {
    // The whole point. Org B's client id is real, well-formed and resolvable by
    // org B — and from inside org A's transaction it does not exist.
    const a = await seedClient('Org A client');
    const b = await seedClient('Org B client');

    await expect(
      withOrgContext(a.ctx, (tx) =>
        requireInOrg(tx, clients, b.clientId, { id: clients.id }, 'invalid'),
      ),
    ).rejects.toBeInstanceOf(ActionError);

    // ...and org B still sees its own row, so nothing was hidden by accident.
    await expect(
      withOrgContext(b.ctx, (tx) =>
        requireInOrg(tx, clients, b.clientId, { id: clients.id }, 'invalid'),
      ),
    ).resolves.toEqual({ id: b.clientId });
  });

  it('refuses an id that exists nowhere with the same code', async () => {
    // Indistinguishable from the cross-tenant case, deliberately: telling a
    // caller which of the two it was would confirm the row exists elsewhere.
    const { ctx } = await seedClient('Acme');
    await expect(
      withOrgContext(ctx, (tx) =>
        requireInOrg(
          tx,
          clients,
          '00000000-0000-4000-8000-000000000000',
          { id: clients.id },
          'invalid',
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('preserves nullability: a null column comes back as null, not missing', async () => {
    const { ctx, clientId } = await seedClient('Acme');
    const row = await withOrgContext(ctx, (tx) =>
      requireInOrg(
        tx,
        clients,
        clientId,
        { id: clients.id, nameAr: clients.nameAr, advancePct: clients.advancePct },
        'invalid',
      ),
    );
    expect(row.nameAr).toBeNull();
    expect(typeof row.advancePct).toBe('string'); // numeric carried as a string
  });
});
