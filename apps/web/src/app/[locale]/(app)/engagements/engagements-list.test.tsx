import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import type { EngagementListRow } from '@/lib/engagements/queries';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementsList } from './engagements-list';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function row(id: string, overrides: Partial<EngagementListRow> = {}): EngagementListRow {
  return {
    id,
    number: 14,
    titleAr: null,
    titleEn: 'Villa fit-out',
    clientId: 'c-1',
    projectId: 'p-1',
    state: 'execution_decision',
    clientNameEn: 'Acme',
    clientNameAr: null,
    projectNameEn: 'Tower',
    projectNameAr: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    whoseMove: 'studio',
    ...overrides,
  };
}

describe('EngagementsList', () => {
  const rows = [
    row('e-1'),
    row('e-2', { state: 'concept_review', whoseMove: 'client' }),
    row('e-3', { state: 'abandoned', whoseMove: 'closed' }),
  ];

  test('every row is ONE link to its delivery', () => {
    renderWithIntl(<EngagementsList items={rows} now={NOW} />, { locale: 'en' });
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/en/engagements/e-1',
      '/en/engagements/e-2',
      '/en/engagements/e-3',
    ]);
  });

  test('the status column is headed "Status", and no row says "Stage N"', () => {
    const { container } = renderWithIntl(<EngagementsList items={rows} now={NOW} />, {
      locale: 'en',
    });
    expect(screen.getByText(messageAt('en', 'engagements.list.status'))).toBeTruthy();
    expect(container.textContent).not.toMatch(/Stage \d/);
    // The stage is said in words from the spine (execution_decision -> Handover).
    expect(container.textContent).toContain(messageAt('en', 'engagements.spine.handover'));
  });

  test('each row carries its status chip, by the one delivery-status rule', () => {
    const statusRows = [
      row('e-1', { whoseMove: 'studio' }),
      row('e-2', { state: 'concept_review', whoseMove: 'client' }),
      row('e-3', { state: 'layout', whoseMove: 'client', updatedAt: '2026-06-01T00:00:00.000Z' }),
      row('e-4', { whoseMove: 'confirmPayment' }),
      row('e-5', { state: 'execution', whoseMove: 'closed' }),
      row('e-6', { state: 'abandoned', whoseMove: 'closed' }),
    ];
    const { container } = renderWithIntl(<EngagementsList items={statusRows} now={NOW} />, {
      locale: 'en',
    });
    const status = (kind: string) => messageAt('en', `engagements.status.${kind}`);
    // The third cell of each row link is the delivery status (the second, the
    // machine state, is a StatusChip too).
    const chips = [...container.querySelectorAll('a')].map(
      (link) => link.children[2].querySelector('[data-tone]') as HTMLElement,
    );
    expect(chips.map((chip) => chip.getAttribute('data-tone'))).toEqual([
      'yourMove',
      'waiting',
      'stalled',
      'yourMove',
      'done',
      'neutral',
    ]);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      status('yourMove'),
      `${status('waitingClient')}·5 days`,
      `${status('stalled')}·14 days`,
      status('confirmPayment'),
      status('delivered'),
      status('abandoned'),
    ]);
  });

  test('each row carries its age', () => {
    renderWithIntl(<EngagementsList items={rows} now={NOW} />, { locale: 'en' });
    expect(screen.getAllByText('5 days')).toHaveLength(3);
  });
});
