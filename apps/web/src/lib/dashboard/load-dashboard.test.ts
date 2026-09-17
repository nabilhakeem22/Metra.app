import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@/lib/permissions/roles';

vi.mock('server-only', () => ({}));

/**
 * S3: the composition that decides firm-null, deliveries-null, canSeeDeliveries
 * and canSeeTeam used to sit in `dashboard/page.tsx`. Wave 5 moved it into a lib
 * module, and it was the only module in lib/dashboard without a test of its own —
 * while `dashboard-view.test.tsx` can only prove the VIEW hides what it is not
 * handed, never that a fenced role is not handed it.
 *
 * A regression here puts firm-wide counts and both donuts in front of a
 * project_manager: the wave-4 A3/A5 finding coming back.
 *
 * THE READS ARE DOUBLED AND THE FENCE IS REAL. `loadFirmFigures` and
 * `canSeeFirmFigures` run for real; only the five queries are replaced, so the
 * assertion "a fenced role costs ZERO round trips" is about the calls that would
 * have been issued — which a database cannot be asked about after the fact.
 */
const getDashboardCounts = vi.fn(async () => ({
  clientsTotal: 7,
  clientsActive: 4,
  projectsTotal: 2,
  projectsActive: 1,
  teamMembers: null,
  deliveriesTotal: 9,
  deliveriesActive: 5,
}));
const getProjectsByMonth = vi.fn(async () => []);
const getClientsByMonth = vi.fn(async () => []);
const listDashboardDeliveries = vi.fn(async () => [
  { id: 'e-1' },
  { id: 'e-2' },
]);
const countActiveDeliveries = vi.fn(async () => 17);

vi.mock('./queries', () => ({
  getDashboardCounts: (...args: unknown[]) => getDashboardCounts(...(args as [])),
  getProjectsByMonth: (...args: unknown[]) => getProjectsByMonth(...(args as [])),
  getClientsByMonth: (...args: unknown[]) => getClientsByMonth(...(args as [])),
  listDashboardDeliveries: (...args: unknown[]) =>
    listDashboardDeliveries(...(args as [])),
  countActiveDeliveries: (...args: unknown[]) => countActiveDeliveries(...(args as [])),
}));

const { loadDashboardFigures } = await import('./load-dashboard');

const ctxAs = (role: MemberRole): OrgContext => ({
  orgId: 'org-1',
  userId: 'user-1',
  role,
});

function load(role: MemberRole, restrictFirmDashboard: boolean) {
  return loadDashboardFigures(ctxAs(role), {
    org: { restrictFirmDashboard },
    range: 6,
  });
}

beforeEach(() => {
  for (const query of [
    getDashboardCounts,
    getProjectsByMonth,
    getClientsByMonth,
    listDashboardDeliveries,
    countActiveDeliveries,
  ]) {
    query.mockClear();
  }
});

describe('loadDashboardFigures — the firm-wide fence', () => {
  // The §2.2 grant, not the org setting, is what fences a PM: they hold the
  // empty cell for `firm_dashboard`, so the toggle changes nothing for them.
  it.each([false, true])(
    'a project_manager gets NO firm block and costs no figure query (toggle=%s)',
    async (restrict) => {
      const figures = await load('project_manager', restrict);
      expect(figures.firm).toBeNull();
      expect(getDashboardCounts).not.toHaveBeenCalled();
      expect(getProjectsByMonth).not.toHaveBeenCalled();
      expect(getClientsByMonth).not.toHaveBeenCalled();
    },
  );

  it('a site_engineer is fenced the same way, with the toggle off', async () => {
    expect((await load('site_engineer', false)).firm).toBeNull();
    expect(getDashboardCounts).not.toHaveBeenCalled();
  });

  // The org setting narrows FURTHER, and it subtracts exactly these two.
  it.each<MemberRole>(['accountant', 'viewer'])(
    'a %s sees firm figures with the toggle OFF and is fenced with it ON',
    async (role) => {
      const open = await load(role, false);
      expect(open.firm).not.toBeNull();
      expect(getDashboardCounts).toHaveBeenCalledTimes(1);

      getDashboardCounts.mockClear();
      const restricted = await load(role, true);
      expect(restricted.firm).toBeNull();
      expect(getDashboardCounts).not.toHaveBeenCalled();
    },
  );

  it.each<MemberRole>(['owner', 'admin'])(
    'a %s sees firm figures either way',
    async (role) => {
      expect((await load(role, false)).firm).not.toBeNull();
      expect((await load(role, true)).firm).not.toBeNull();
      expect(getDashboardCounts).toHaveBeenCalledTimes(2);
    },
  );
});

describe('loadDashboardFigures — the deliveries panel', () => {
  // The badge counts the SAME rows the panel lists, so a role entitled to the
  // work list but not to firm figures still gets a TRUE number rather than the
  // capped rows.length. The fenced path is the ONLY one that pays for the count.
  it('takes totalActive from countActiveDeliveries on the fenced path', async () => {
    const figures = await load('project_manager', false);
    expect(figures.deliveries?.rows).toHaveLength(2);
    expect(figures.deliveries?.totalActive).toBe(17);
    expect(countActiveDeliveries).toHaveBeenCalledTimes(1);
  });

  it('takes it from the firm block when there is one, with no extra query', async () => {
    const figures = await load('owner', false);
    expect(figures.deliveries?.totalActive).toBe(5);
    expect(countActiveDeliveries).not.toHaveBeenCalled();
  });

  it('is NULL, and unqueried, for a role that cannot read engagements', async () => {
    // `client` never reaches this page (require-org.ts notFound()s the whole
    // group), but the predicate must not depend on a fence somewhere else.
    const figures = await load('client', false);
    expect(figures.deliveries).toBeNull();
    expect(figures.canSeeDeliveries).toBe(false);
    expect(listDashboardDeliveries).not.toHaveBeenCalled();
    expect(countActiveDeliveries).not.toHaveBeenCalled();
  });
});

describe('loadDashboardFigures — the team headcount', () => {
  it('tracks users_settings:read, and travels into the firm read', async () => {
    expect((await load('owner', false)).canSeeTeam).toBe(true);
    expect(getDashboardCounts).toHaveBeenCalledWith(expect.anything(), {
      includeTeamMembers: true,
    });

    getDashboardCounts.mockClear();
    expect((await load('accountant', false)).canSeeTeam).toBe(false);
    expect(getDashboardCounts).toHaveBeenCalledWith(expect.anything(), {
      includeTeamMembers: false,
    });
  });
});
