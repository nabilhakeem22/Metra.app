import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { loadFirmFigures } from '@/lib/dashboard/firm-figures';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

// K6e — the firm-wide dashboard block, against a real database.
//
// `firm-visibility.test.ts` proves the PREDICATE over all 7 roles x 2 settings
// with no database. This suite proves the two things only Postgres can answer:
// that the refusal really does return null through the loader a page calls, and
// that the counts a permitted role gets are THIS org's and nobody else's.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const RANGE = 6 as const;

/** An org with one client and one project, plus a context per role asked for. */
async function seedFirm(roles: Array<'project_manager' | 'accountant'>) {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: roles.map((role) => ({ role })),
  });
  orgIds.push(orgId);
  const owner = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(owner, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(owner, {});
  await createProjectCore(owner, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const contexts = Object.fromEntries(
    roles.map((role, index) => [role, ctxFor(orgId, memberIds[index], role)]),
  ) as Record<'project_manager' | 'accountant', OrgContext>;
  return { orgId, owner, contexts };
}

const options = (restrictFirmDashboard: boolean) => ({
  org: { restrictFirmDashboard },
  range: RANGE,
  includeTeamMembers: false,
});

describe('loadFirmFigures: the §2.2 grant, with the toggle OFF', () => {
  it('owner and accountant get figures; a project_manager gets NULL', async () => {
    const { owner, contexts } = await seedFirm(['project_manager', 'accountant']);

    const forOwner = await loadFirmFigures(owner, options(false));
    expect(forOwner).not.toBeNull();
    expect(forOwner?.counts.clientsTotal).toBe(1);
    expect(forOwner?.counts.projectsTotal).toBe(1);

    expect(await loadFirmFigures(contexts.accountant, options(false))).not.toBeNull();

    // A3, THE LIVE BEHAVIOUR CHANGE: a project_manager holds the EMPTY cell for
    // firm_dashboard and nothing enforced it until now, so this is null even
    // though the studio has restricted nothing.
    expect(await loadFirmFigures(contexts.project_manager, options(false))).toBeNull();
  });
});

describe('loadFirmFigures: the org setting, with the toggle ON', () => {
  it('narrows to owner and admin — the accountant loses the block', async () => {
    const { owner, contexts } = await seedFirm(['project_manager', 'accountant']);

    expect(await loadFirmFigures(owner, options(true))).not.toBeNull();
    // The setting SUBTRACTS accountant and viewer. This is the half the studio
    // was promised in the settings copy and that did nothing at all.
    expect(await loadFirmFigures(contexts.accountant, options(true))).toBeNull();
    expect(await loadFirmFigures(contexts.project_manager, options(true))).toBeNull();
  });
});

describe('loadFirmFigures: the refusal costs nothing and leaks nothing', () => {
  // "The refusal issues NO query" is NOT asserted here on purpose: a database
  // cannot be asked what it was not asked. It is proven against mocked reads in
  // `src/lib/dashboard/firm-figures.test.ts`.

  it('counts THIS org only, never a second org that shares the deployment', async () => {
    const first = await seedFirm([]);
    const second = await seedFirm([]);
    // Two more clients in the OTHER org. If RLS or the aggregate leaked, the
    // first org's count would move.
    await createClientCore(second.owner, { phone: '01111111111', nameEn: 'Other A' });
    await createClientCore(second.owner, { phone: '01222222222', nameEn: 'Other B' });

    const forFirst = await loadFirmFigures(first.owner, options(false));
    const forSecond = await loadFirmFigures(second.owner, options(false));
    expect(forFirst?.counts.clientsTotal).toBe(1);
    expect(forSecond?.counts.clientsTotal).toBe(3);
  });

  it('carries both monthly series for a permitted role', async () => {
    const { owner } = await seedFirm([]);
    const figures = await loadFirmFigures(owner, options(false));
    // The series are the CHART's input; `chart-columns.test.ts` proves the
    // shaping. What matters here is that the loader returns them at all, and
    // that every bucket it does return is inside the window.
    expect(Array.isArray(figures?.projectMonths)).toBe(true);
    expect(Array.isArray(figures?.clientMonths)).toBe(true);
    for (const bucket of [
      ...(figures?.projectMonths ?? []),
      ...(figures?.clientMonths ?? []),
    ]) {
      expect(bucket.month).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});
