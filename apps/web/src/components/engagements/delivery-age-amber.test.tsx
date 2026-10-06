import { describe, expect, test, vi } from 'vitest';
import { EngagementsList } from '@/app/[locale]/(app)/engagements/engagements-list';
import { DeliveriesPanel } from '@/components/dashboard/deliveries-panel';
import type { DashboardDelivery } from '@/lib/dashboard/queries';
import type { EngagementListRow } from '@/lib/engagements/queries';
import type { WhoseMove } from '@/lib/engagements/whose-move';
import { renderWithIntl } from '@/test/render-with-intl';

// Ported from the A2 tester's repro (t1a2/list-age-amber): the age beside the
// status chip is amber ONLY when the status is stalled (the client's move, 7+
// days), never because the delivery is merely old.

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

const NOW = new Date('2026-06-15T12:00:00.000Z');
const THIRTY_DAYS_AGO = '2026-05-16T00:00:00.000Z';

const CASES: { id: string; whoseMove: WhoseMove; state: 'layout' | 'execution'; amber: boolean }[] = [
  { id: 'studio', whoseMove: 'studio', state: 'layout', amber: false },
  { id: 'payment', whoseMove: 'confirmPayment', state: 'layout', amber: false },
  { id: 'client', whoseMove: 'client', state: 'layout', amber: true },
  { id: 'closed', whoseMove: 'closed', state: 'execution', amber: false },
];

function amberIn(row: Element): boolean {
  return [...row.querySelectorAll('*')].some((element) =>
    (element.getAttribute('class') ?? '').includes('var(--warn)') &&
    !element.closest('[data-tone]'),
  );
}

describe('the age label is amber only when the delivery is stalled', () => {
  test('deliveries list', () => {
    const rows: EngagementListRow[] = CASES.map(({ id, whoseMove, state }) => ({
      id,
      number: 1,
      titleAr: null,
      titleEn: id,
      clientId: 'c',
      projectId: 'p',
      state,
      clientNameEn: 'Acme',
      clientNameAr: null,
      projectNameEn: 'T',
      projectNameAr: null,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: THIRTY_DAYS_AGO,
      whoseMove,
    }));
    const { container } = renderWithIntl(<EngagementsList items={rows} now={NOW} />, {
      locale: 'en',
    });
    const items = [...container.querySelectorAll('li')];
    expect(items.map(amberIn)).toEqual(CASES.map((c) => c.amber));
  });

  test('dashboard panel', async () => {
    const deliveries: DashboardDelivery[] = CASES.map(({ id, whoseMove, state }) => ({
      id,
      state,
      clientNameEn: id,
      clientNameAr: null,
      projectNameEn: 'T',
      projectNameAr: null,
      updatedAt: THIRTY_DAYS_AGO,
      whoseMove,
    }));
    const panel = await DeliveriesPanel({
      deliveries,
      totalActive: deliveries.length,
      empty: { reason: 'noDelivery', cta: null },
      locale: 'en',
      now: NOW,
    });
    const { container } = renderWithIntl(panel, { locale: 'en' });
    const items = [...container.querySelectorAll('li')];
    expect(items.map(amberIn)).toEqual(CASES.map((c) => c.amber));
  });
});
