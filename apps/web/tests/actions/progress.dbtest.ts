import type { Organization } from '@metra/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore, setClientActiveCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { mintDeliveryLinkCore, revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { getOnboardingProgress } from '@/lib/onboarding/progress';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import {
  closeFixture,
  ctxFor,
  raw,
  seedOrg,
  seedPendingInvite,
  teardown,
} from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const orgWithCity = { nameEn: 'Org', nameAr: null, city: 'Cairo' } as unknown as Organization;
const orgNoCity = { nameEn: 'Org', nameAr: null, city: null } as unknown as Organization;

/** A new project (and client) with one delivery started on it; the delivery's id. */
async function startDelivery(ctx: OrgContext, code: string): Promise<string> {
  await createClientCore(ctx, { phone: '01000000000', nameEn: `Client ${code}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code, nameEn: `Project ${code}`, clientId: client.id, status: 'active' });
  const project = (await listProjects(ctx, {})).find((row) => row.code === code)!;
  const started = await createEngagementCore(ctx, { titleEn: code, clientId: client.id, projectId: project.id });
  expect(started.ok).toBe(true);
  return (started as { data?: string }).data!;
}

describe('getOnboardingProgress — in-org rows only', () => {
  it('each flag reflects only THIS org (another org does not flip it)', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    await createClientCore(ctx, { phone: '01000000000', nameEn: 'C' });
    const [client] = await listClients(ctx, {});
    await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code: 'P', nameEn: 'Proj', clientId: client.id, status: 'active' });
    const [project] = await listProjects(ctx, {});
    const started = await createEngagementCore(ctx, { titleEn: 'D', clientId: client.id, projectId: project.id });
    expect(started.ok).toBe(true);
    expect((await mintDeliveryLinkCore(ctx, (started as { data?: string }).data!)).ok).toBe(true);
    await seedPendingInvite(orgId, 'invitee@example.com', ownerIds[0], 'viewer');

    const pa = await getOnboardingProgress(ctx, orgWithCity);
    expect(pa).toEqual({
      profileComplete: true,
      teamInvited: true, // pending invite
      hasClient: true,
      hasProject: true,
      hasEngagement: true,
      hasSharedDelivery: true,
      newestUnsharedDeliveryId: null,
    });

    // A pristine second org sees NONE of org A's rows.
    const b = await seedOrg({ owners: 1 });
    orgIds.push(b.orgId);
    const bctx = ctxFor(b.orgId, b.ownerIds[0], 'owner');
    const pb = await getOnboardingProgress(bctx, orgNoCity);
    expect(pb).toEqual({
      profileComplete: false,
      teamInvited: false,
      hasClient: false,
      hasProject: false,
      hasEngagement: false,
      hasSharedDelivery: false,
      newestUnsharedDeliveryId: null,
    });
  });

  it('teamInvited on 2 members', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1, members: [{ role: 'viewer' }] });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect((await getOnboardingProgress(ctx, orgNoCity)).teamInvited).toBe(true);
  });

  it('share: the newest unshared in-flight delivery is the target, until every link is out', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const older = await startDelivery(ctx, 'OLD');
    const newer = await startDelivery(ctx, 'NEW');
    await raw.query(
      `update public.design_engagements set created_at = created_at - interval '1 hour' where id = '${older}'`,
    );

    let progress = await getOnboardingProgress(ctx, orgNoCity);
    expect(progress).toMatchObject({ hasEngagement: true, hasSharedDelivery: false, newestUnsharedDeliveryId: newer });

    expect((await mintDeliveryLinkCore(ctx, newer)).ok).toBe(true);
    progress = await getOnboardingProgress(ctx, orgNoCity);
    expect(progress).toMatchObject({ hasSharedDelivery: true, newestUnsharedDeliveryId: older });

    // A closed delivery is never a share target.
    await raw.query(`update public.design_engagements set state = 'abandoned' where id = '${older}'`);
    expect((await getOnboardingProgress(ctx, orgNoCity)).newestUnsharedDeliveryId).toBeNull();

    // Revoking the only live link asks the studio to share again.
    expect((await revokeDeliveryLinkCore(ctx, newer)).ok).toBe(true);
    progress = await getOnboardingProgress(ctx, orgNoCity);
    expect(progress).toMatchObject({ hasSharedDelivery: false, newestUnsharedDeliveryId: newer });

    // Another org's unshared delivery is never this org's target.
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const otherCtx = ctxFor(other.orgId, other.ownerIds[0], 'owner');
    expect((await getOnboardingProgress(otherCtx, orgNoCity)).newestUnsharedDeliveryId).toBeNull();
  });

  it('a deactivated client does not count: the ladder still asks for a client', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { phone: '01000000000', nameEn: 'C' });
    const [client] = await listClients(ctx, {});
    expect((await getOnboardingProgress(ctx, orgNoCity)).hasClient).toBe(true);
    expect((await setClientActiveCore(ctx, { id: client.id, active: false })).ok).toBe(true);
    expect((await getOnboardingProgress(ctx, orgNoCity)).hasClient).toBe(false);
  });
});
