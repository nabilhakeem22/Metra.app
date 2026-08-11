import type { Organization } from '@metra/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { getOnboardingProgress } from '@/lib/onboarding/progress';
import { createCostItemCore } from '@/lib/price-book/core';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
} from '@/lib/proposals/core';
import {
  closeFixture,
  ctxFor,
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

describe('getOnboardingProgress — in-org rows only', () => {
  it('each flag reflects only THIS org (another org does not flip it)', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    await createClientCore(ctx, { nameEn: 'C' });
    const [client] = await listClients(ctx, {});
    await createProjectCore(ctx, { code: 'P', nameEn: 'Proj', clientId: client.id, status: 'active' });
    const [project] = await listProjects(ctx, {});
    await createCostItemCore(ctx, { code: 'CI', nameEn: 'Item', category: 'civil', unit: 'sqm', defaultUnitCost: '1', defaultUnitPrice: '2' });
    const propId = ((await createProposalCore(ctx, { clientId: client.id, projectId: project.id })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id: propId, sections: [{ titleEn: 'S', lines: [{ descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: '0', unitPrice: '1', discountPct: '0' }] }] });
    await sendProposalCore(ctx, { id: propId });
    await seedPendingInvite(orgId, 'invitee@example.com', ownerIds[0], 'viewer');

    const pa = await getOnboardingProgress(ctx, orgWithCity);
    expect(pa).toEqual({
      profileComplete: true,
      teamInvited: true, // pending invite
      hasClient: true,
      hasProject: true,
      hasCostItem: true,
      hasProposal: true,
      hasSentProposal: true,
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
      hasCostItem: false,
      hasProposal: false,
      hasSentProposal: false,
    });
  });

  it('hasSentProposal stays false for a draft-only org, teamInvited on 2 members', async () => {
    const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members: [{ role: 'viewer' }] });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    void memberIds;
    await createClientCore(ctx, { nameEn: 'C' });
    const [client] = await listClients(ctx, {});
    await createProjectCore(ctx, { code: 'P', nameEn: 'Proj', clientId: client.id, status: 'active' });
    const [project] = await listProjects(ctx, {});
    await createProposalCore(ctx, { clientId: client.id, projectId: project.id });

    const p = await getOnboardingProgress(ctx, orgNoCity);
    expect(p.teamInvited).toBe(true); // 2 members
    expect(p.hasProposal).toBe(true);
    expect(p.hasSentProposal).toBe(false); // still draft
  });
});
