import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { loadSourceGraph, SRC_ROOT } from '@/test/source-graph';

// AC18: the rescue ledger costs the dashboard render NOTHING. The page decides
// only WHETHER to render the island (a pure predicate); the ledger's query and
// core are unreachable from it, and it opens no extra org context.

const deps = vi.hoisted(() => ({
  role: 'owner' as string,
  withOrgContext: vi.fn(),
  loadDashboardFigures: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: async () => ({ orgId: 'org-1', userId: 'user-1', role: deps.role }) }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: async () => ({ id: 'user-1', user_metadata: {} }) }));
vi.mock('@/lib/db/context', () => ({ withOrgContext: deps.withOrgContext }));
vi.mock('@/lib/onboarding/progress', () => ({ getOnboardingProgress: async () => ({}) }));
vi.mock('@/lib/onboarding/checklist', () => ({ buildChecklist: () => ({ items: [], percent: 0, allDone: false }) }));
vi.mock('@/lib/dashboard/load-dashboard', () => ({ loadDashboardFigures: deps.loadDashboardFigures }));

const { default: DashboardPage } = await import('./page');

const ORG = { id: 'org-1', nameEn: 'Studio', nameAr: null, hideMarginFromPm: true, restrictFirmDashboard: false };

beforeEach(() => {
  deps.withOrgContext.mockReset();
  deps.withOrgContext.mockResolvedValue([ORG]);
  deps.loadDashboardFigures.mockReset();
  deps.loadDashboardFigures.mockResolvedValue({ firm: null, deliveries: null, canSeeDeliveries: false, canSeeTeam: false });
});

async function renderPage(role: string, range = '12') {
  deps.role = role;
  return (await DashboardPage({ searchParams: Promise.resolve({ range }) })) as { props: { rescue: unknown } };
}

describe('dashboard page: the rescue ledger island', () => {
  it.each(['owner', 'admin', 'accountant'])('hands %s the island with the window, and opens no extra org context', async (role) => {
    const element = await renderPage(role);
    expect(element.props.rescue).toEqual({ range: 12 });
    expect(deps.withOrgContext).toHaveBeenCalledTimes(1);
    expect(deps.loadDashboardFigures).toHaveBeenCalledTimes(1);
  });

  it.each(['project_manager', 'site_engineer', 'viewer'])('hands %s no island', async (role) => {
    expect((await renderPage(role)).props.rescue).toBeNull();
    expect(deps.withOrgContext).toHaveBeenCalledTimes(1);
  });

  it('hands the accountant no island when the studio limits firm figures', async () => {
    deps.withOrgContext.mockResolvedValue([{ ...ORG, restrictFirmDashboard: true }]);
    expect((await renderPage('accountant')).props.rescue).toBeNull();
  });

  it('never reaches the ledger query or core from the page, through any import', () => {
    const graph = loadSourceGraph();
    const page = join(SRC_ROOT, 'app', '[locale]', '(app)', 'dashboard', 'page.tsx');
    const seen = new Set<string>();
    const pending = [page];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      pending.push(...graph.importsOf(path));
    }
    const ledger = join(SRC_ROOT, 'lib', 'dashboard', 'rescue-ledger');
    expect(seen.has(join(ledger, 'visibility.ts'))).toBe(true);
    for (const server of ['queries.ts', 'core.ts', 'rescue-facts-sql.ts']) expect(seen.has(join(ledger, server))).toBe(false);
  });
});
