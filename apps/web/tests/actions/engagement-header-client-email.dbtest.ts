// Client home H2: the cockpit header says whether the client has an email a
// one-time code could go to (the primary contact's, else the client's own),
// read in the header's own statement. Only the flag leaves the query.
import { afterAll, describe, expect, it } from 'vitest';
import { createContactCore } from '@/lib/client-contacts/core';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { getEngagementHeader } from '@/lib/engagements/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** An org whose one client has `email` on its own record, and one delivery for it. */
async function deliveryFor(email: string | null): Promise<{ ctx: OrgContext; clientId: string; engagementId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme', email });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, { titleEn: 'Villa', clientId: client.id, projectId: project.id, offPlan: false });
  return { ctx, clientId: client.id, engagementId: (created as { data?: string }).data! };
}

const flag = async (ctx: OrgContext, engagementId: string) => (await getEngagementHeader(ctx, engagementId))?.clientHasEmail;

describe('the header knows whether the client has an email on file', () => {
  it("the client's own email is enough", async () => {
    const { ctx, engagementId } = await deliveryFor('client@example.test');
    expect(await flag(ctx, engagementId)).toBe(true);
  });

  it('no email anywhere reads false; a primary contact with one turns it true', async () => {
    const { ctx, clientId, engagementId } = await deliveryFor(null);
    expect(await flag(ctx, engagementId)).toBe(false);
    await createContactCore(ctx, { clientId, name: 'Primary', isPrimary: true, email: 'primary@example.test' });
    expect(await flag(ctx, engagementId)).toBe(true);
  });

  it('a contact that is not the primary one does not count', async () => {
    const { ctx, clientId, engagementId } = await deliveryFor(null);
    await createContactCore(ctx, { clientId, name: 'Primary', isPrimary: true });
    await createContactCore(ctx, { clientId, name: 'Other', email: 'other@example.test' });
    expect(await flag(ctx, engagementId)).toBe(false);
  });

  it('an address of only spaces is no address', async () => {
    const { ctx, clientId, engagementId } = await deliveryFor(null);
    // Written past the cores (which trim): the read must not trust that every writer did.
    await raw.query(`update public.clients set email = '   ' where id = '${clientId}'`);
    expect(await flag(ctx, engagementId)).toBe(false);
  });
});
