import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

vi.mock('server-only', () => ({}));

// The reads are replaced so the ONE property this module owns can be asserted:
// a refused role costs NO round trip. That is not a micro-optimisation — a
// figure that is never computed cannot reach a log line, a cache or a
// serialisation slip, and `dashboard-firm.dbtest.ts` cannot prove it, because a
// database cannot be asked what it was not asked.
const getDashboardCounts = vi.fn(async () => ({
  clientsTotal: 7,
  clientsActive: 4,
  projectsTotal: 2,
  projectsActive: 1,
  teamMembers: null,
  deliveriesTotal: 3,
  deliveriesActive: 2,
}));
const getProjectsByMonth = vi.fn(async () => [
  { month: '2026-06', active: 1, completed: 0, other: 0 },
]);
const getClientsByMonth = vi.fn(async () => [
  { month: '2026-06', active: 4, inactive: 3 },
]);
vi.mock('./queries', () => ({
  getDashboardCounts: (...args: unknown[]) => getDashboardCounts(...(args as [])),
  getProjectsByMonth: (...args: unknown[]) => getProjectsByMonth(...(args as [])),
  getClientsByMonth: (...args: unknown[]) => getClientsByMonth(...(args as [])),
}));

const { loadFirmFigures } = await import('./firm-figures');

const ctxAs = (role: OrgContext['role']): OrgContext => ({
  orgId: 'org-1',
  userId: 'user-1',
  role,
});

const options = (restrictFirmDashboard: boolean) => ({
  org: { restrictFirmDashboard },
  range: 6 as const,
  includeTeamMembers: false,
});

beforeEach(() => {
  getDashboardCounts.mockClear();
  getProjectsByMonth.mockClear();
  getClientsByMonth.mockClear();
});

describe('loadFirmFigures', () => {
  it('issues NO query at all for a role that may not see firm figures', async () => {
    expect(await loadFirmFigures(ctxAs('project_manager'), options(false))).toBeNull();
    expect(getDashboardCounts).not.toHaveBeenCalled();
    expect(getProjectsByMonth).not.toHaveBeenCalled();
    expect(getClientsByMonth).not.toHaveBeenCalled();
  });

  it('issues NO query for a role the ORG has narrowed out', async () => {
    expect(await loadFirmFigures(ctxAs('accountant'), options(true))).toBeNull();
    expect(getDashboardCounts).not.toHaveBeenCalled();
  });

  it('returns all three reads for a permitted role', async () => {
    const figures = await loadFirmFigures(ctxAs('owner'), options(true));
    expect(figures?.counts.clientsTotal).toBe(7);
    expect(figures?.projectMonths).toHaveLength(1);
    expect(figures?.clientMonths).toHaveLength(1);
    expect(getDashboardCounts).toHaveBeenCalledTimes(1);
    expect(getProjectsByMonth).toHaveBeenCalledTimes(1);
    expect(getClientsByMonth).toHaveBeenCalledTimes(1);
  });

  it('passes the team-headcount flag through rather than deciding it here', async () => {
    // The team card has its OWN gate (`users_settings`), and it sits inside the
    // firm block. Two gates, and this module owns only one of them.
    await loadFirmFigures(ctxAs('owner'), {
      org: { restrictFirmDashboard: false },
      range: 6,
      includeTeamMembers: true,
    });
    expect(getDashboardCounts).toHaveBeenCalledWith(expect.anything(), {
      includeTeamMembers: true,
    });
  });
});
