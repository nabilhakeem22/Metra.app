import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { messageAt, renderWithIntl, TEST_NOW } from '@/test/render-with-intl';
import type { DashboardDelivery } from '@/lib/dashboard/queries';
import { DashboardView, type DashboardViewProps } from './dashboard-view';

// Three children are replaced by MARKER stubs, each for a stated reason:
//  - DeliveriesPanel is an ASYNC server component (it awaits getTranslations), and
//    React's client renderer cannot render a component that returns a promise. Its
//    marker echoes the totalActive it was handed, which is the claim under test.
//  - GettingStarted and DashboardRangeFilter are 'use client' leaves with their
//    own behaviour; this file is about the FENCE, not about them.
vi.mock('@/components/dashboard/deliveries-panel', () => ({
  DeliveriesPanel: ({ totalActive, deliveries }: { totalActive: number; deliveries: unknown[] }) => (
    <div data-testid="deliveries-panel">
      <span data-testid="deliveries-total">{totalActive}</span>
      <span data-testid="deliveries-rows">{deliveries.length}</span>
    </div>
  ),
}));
vi.mock('@/components/dashboard/getting-started', () => ({
  GettingStarted: () => <div data-testid="getting-started" />,
}));
vi.mock('@/components/dashboard/dashboard-range-filter', () => ({
  DashboardRangeFilter: () => <div data-testid="range-filter" />,
}));

const en = (path: string) => messageAt('en', path);

function delivery(id: string): DashboardDelivery {
  return {
    id,
    state: 'concept_review',
    clientNameEn: 'Nile Interiors',
    clientNameAr: null,
    projectNameEn: 'Maadi Flat',
    projectNameAr: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

const FIRM_BLOCK: NonNullable<DashboardViewProps['firm']> = {
  counts: {
    clientsTotal: 12,
    clientsActive: 9,
    projectsTotal: 7,
    projectsActive: 4,
    teamMembers: 5,
    deliveriesTotal: 21,
    deliveriesActive: 17,
  },
  charts: { projects: [], clients: [] },
  range: 6,
  canSeeDeliveries: true,
  canSeeTeam: true,
};

function renderView(overrides: Partial<DashboardViewProps> = {}) {
  return renderWithIntl(
    <DashboardView
      identity={{
        role: 'project_manager',
        orgName: { value: 'Studio Nile', isFallback: false },
        primaryCta: { href: '/projects', messageKey: 'cards.projects' },
      }}
      onboarding={{
        checklist: { items: [], percent: 0, allDone: false },
        orgId: 'org-1',
        dismissed: false,
      }}
      firm={null}
      deliveries={{ rows: [delivery('d-1'), delivery('d-2')], totalActive: 17 }}
      locale="en"
      now={TEST_NOW}
      {...overrides}
    />,
    { locale: 'en' },
  );
}

// dashboard.cards.projects is NOT in this list: a project manager's real primary
// CTA reuses that very string, so "it must not appear" would be false for a reason
// that has nothing to do with the fence. It is asserted by COUNT instead.
const FIRM_ONLY_TEXT = [
  'dashboard.cards.clients',
  'dashboard.cards.deliveries',
  'dashboard.cards.team',
  'dashboard.charts.projects',
  'dashboard.charts.clients',
];

/**
 * Wave 4's A3/A5: the fenced project-manager view. The plan asserted that a role
 * the firm has not entitled to firm-wide figures sees NOTHING where the cards
 * were — no locked card, no notice. Nothing has ever rendered it.
 */
describe('DashboardView — the fence, with firm = null', () => {
  test('the role pill, the org name, the greeting and the primary CTA are all present', () => {
    renderView();
    expect(screen.getByText(en('roles.project_manager.label'))).toBeTruthy();
    expect(screen.getByText('Studio Nile')).toBeTruthy();
    expect(screen.getByText(en('dashboard.welcomeBack'))).toBeTruthy();
    const cta = screen.getByRole('link', { name: en('dashboard.cards.projects') });
    expect(cta.getAttribute('href')).toContain('/projects');
  });

  test('Getting Started is present — onboarding is not part of the fence', () => {
    renderView();
    expect(screen.getByTestId('getting-started')).toBeTruthy();
  });

  // A4: the panel's badge counts the SAME rows the panel lists, so a role entitled
  // to the work list but not to firm figures gets a TRUE number rather than the
  // capped rows.length.
  test('the deliveries panel shows the TRUE total 17, not the 2 rows it was given', () => {
    renderView();
    expect(screen.getByTestId('deliveries-total').textContent).toBe('17');
    expect(screen.getByTestId('deliveries-rows').textContent).toBe('2');
  });

  test('NOTHING renders where the firm block would be — no card, no donut, no filter', () => {
    renderView();
    for (const path of FIRM_ONLY_TEXT) {
      expect(screen.queryByText(en(path))).toBeNull();
    }
    expect(screen.queryByTestId('range-filter')).toBeNull();
    // The one remaining occurrence of the projects label is the CTA link itself.
    const projectsLabels = screen.getAllByText(en('dashboard.cards.projects'));
    expect(projectsLabels).toHaveLength(1);
    expect(projectsLabels[0]?.closest('a')).toBeTruthy();
  });
});

describe('DashboardView — the fence proves BOTH ways', () => {
  test('with firm populated and canSeeTeam, all four cards, both donuts and the filter ARE present', () => {
    renderView({ firm: FIRM_BLOCK });
    for (const path of FIRM_ONLY_TEXT) {
      expect(screen.getAllByText(en(path)).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('range-filter')).toBeTruthy();
    // Two now: the stat card AND the CTA link that shares its string.
    expect(screen.getAllByText(en('dashboard.cards.projects'))).toHaveLength(2);
  });

  test('canSeeTeam false drops the team card and keeps the other three', () => {
    renderView({ firm: { ...FIRM_BLOCK, canSeeTeam: false } });
    expect(screen.queryByText(en('dashboard.cards.team'))).toBeNull();
    expect(screen.getAllByText(en('dashboard.cards.clients')).length).toBeGreaterThan(0);
  });

  test('canSeeDeliveries false drops the deliveries CARD', () => {
    renderView({ firm: { ...FIRM_BLOCK, canSeeDeliveries: false } });
    expect(screen.queryByText(en('dashboard.cards.deliveries'))).toBeNull();
  });

  test('deliveries = null removes the panel entirely', () => {
    renderView({ deliveries: null });
    expect(screen.queryByTestId('deliveries-panel')).toBeNull();
  });
});
