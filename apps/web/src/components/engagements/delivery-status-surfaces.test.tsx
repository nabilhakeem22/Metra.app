import { describe, expect, test, vi } from 'vitest';
import { EngagementHeaderCard } from '@/app/[locale]/(app)/engagements/[id]/engagement-header-card';
import { EngagementsList } from '@/app/[locale]/(app)/engagements/engagements-list';
import { DeliveriesPanel } from '@/components/dashboard/deliveries-panel';
import type { DashboardDelivery } from '@/lib/dashboard/queries';
import { deliveryStatusAsOf } from '@/lib/engagements/delivery-status';
import type { EngagementHeader, EngagementListRow } from '@/lib/engagements/queries';
import type { WhoseMove } from '@/lib/engagements/whose-move';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';

// The dashboard panel is a server component: its own next-intl/server reads are
// replaced so it can be awaited here. The status chip inside it is the shared
// client-safe component, rendered for real against the catalogue.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

const NOW = new Date('2026-06-15T12:00:00.000Z');
const STATUS_KINDS = ['yourMove', 'confirmPayment', 'waitingClient', 'stalled', 'delivered', 'abandoned'];

/** One delivery, as each of the three surfaces receives it. */
function fixture(whoseMove: WhoseMove, updatedAt: string) {
  const shared = {
    id: 'e-1',
    state: 'concept_review' as const,
    clientNameEn: 'Acme',
    clientNameAr: null,
    projectNameEn: 'Tower',
    projectNameAr: null,
    updatedAt,
  };
  const listRow: EngagementListRow = {
    ...shared,
    number: 14,
    titleAr: null,
    titleEn: 'Villa',
    clientId: 'c-1',
    projectId: 'p-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    whoseMove,
  };
  const dashboardRow: DashboardDelivery = { ...shared, whoseMove };
  const header = {
    ...shared,
    number: 14,
    titleAr: null,
    titleEn: 'Villa',
    clientId: 'c-1',
    projectId: 'p-1',
    designFee: null,
    offPlan: false,
    asBuiltDue: false,
    freeRevisionN: 3,
    revisionCount: 0,
    freeDesignRevisionN: 3,
    designRevisionCount: 0,
    romLow: null,
    romHigh: null,
    romIssuedAt: null,
    conceptLockedAt: null,
    renderManifestHash: null,
    rendersReadyAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
  } satisfies EngagementHeader;
  return { listRow, dashboardRow, header };
}

async function chipsOnEverySurface(whoseMove: WhoseMove, updatedAt: string) {
  const { listRow, dashboardRow, header } = fixture(whoseMove, updatedAt);
  const list = renderWithIntl(<EngagementsList items={[listRow]} now={NOW} />, { locale: 'en' });
  const panel = await DeliveriesPanel({
    deliveries: [dashboardRow],
    totalActive: 1,
    empty: { reason: 'noDelivery', cta: null },
    locale: 'en',
    now: NOW,
  });
  const dashboard = renderWithIntl(panel, { locale: 'en' });
  const page = renderWithIntl(
    <EngagementHeaderCard
      header={header}
      shared={false}
      status={deliveryStatusAsOf({ ...header, whoseMove }, NOW)}
    />,
    { locale: 'en' },
  );
  // The list's state column is a StatusChip too; the delivery status chip is
  // the one that says a delivery status.
  const statusLabels = STATUS_KINDS.map((kind) => messageAt('en', `engagements.status.${kind}`));
  return [list, dashboard, page].map(({ container }) => {
    const chip = [...container.querySelectorAll('[data-tone]')].find((candidate) =>
      statusLabels.some((label) => candidate.textContent?.startsWith(label)),
    );
    return { tone: chip?.getAttribute('data-tone'), text: chip?.textContent };
  });
}

describe('one delivery says the same status on the list, the dashboard and its page', () => {
  test.each([
    ['studio', '2026-06-10T00:00:00.000Z', 'yourMove', 'yourMove', ''],
    ['confirmPayment', '2026-06-10T00:00:00.000Z', 'yourMove', 'confirmPayment', ''],
    ['client', '2026-06-09T00:00:00.000Z', 'waiting', 'waitingClient', '·6 days'],
    ['client', '2026-06-08T00:00:00.000Z', 'stalled', 'stalled', '·7 days'],
  ] as const)('%s, changed %s', async (whoseMove, updatedAt, tone, kind, detail) => {
    const label = messageAt('en', `engagements.status.${kind}`);
    const surfaces = await chipsOnEverySurface(whoseMove, updatedAt);
    expect(surfaces).toEqual([
      { tone, text: `${label}${detail}` },
      { tone, text: `${label}${detail}` },
      { tone, text: `${label}${detail}` },
    ]);
  });
});
