import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { EngagementListRow } from '@/lib/engagements/queries';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementsClient } from './engagements-client';

vi.mock('@/lib/engagements/actions', () => ({}));

const en = (path: string) => messageAt('en', path);

const ROW: EngagementListRow = {
  id: 'e-1',
  number: 14,
  titleAr: null,
  titleEn: 'Villa fit-out',
  clientId: 'c-1',
  projectId: 'p-1',
  state: 'layout',
  clientNameEn: 'Acme',
  clientNameAr: null,
  projectNameEn: 'Tower',
  projectNameAr: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
  whoseMove: 'studio',
};

function renderList(options: {
  items?: EngagementListRow[];
  mine: boolean;
  truncatedAt?: number | null;
  nextBefore?: number | null;
}) {
  return renderWithIntl(
    <EngagementsClient
      items={options.items ?? [ROW]}
      paging={{ nextBefore: options.nextBefore ?? null, isFirstPage: true }}
      view={{ mine: options.mine, truncatedAt: options.truncatedAt ?? null }}
      clientOptions={[]}
      projectOptions={[]}
      canCreate={false}
      setupLinks={{ canAddClient: false, canAddProject: false }}
      openCreateOnArrival={false}
      nowIso="2026-06-15T12:00:00.000Z"
    />,
    { locale: 'en' },
  );
}

describe('EngagementsClient: All / My move', () => {
  test('"All" is current by default and links to My move', () => {
    renderList({ mine: false, nextBefore: 9 });
    const all = screen.getByRole('link', { name: en('engagements.list.filter.all') });
    const mine = screen.getByRole('link', { name: en('engagements.list.filter.mine') });
    expect(all.getAttribute('aria-current')).toBe('page');
    expect(mine.getAttribute('aria-current')).toBeNull();
    expect(mine.getAttribute('href')).toBe('/en/engagements?move=mine');
    expect(screen.getByRole('navigation', { name: en('engagements.list.pages') })).toBeTruthy();
  });

  test('?move=mine marks My move current and hides the pager', () => {
    renderList({ mine: true, nextBefore: 9 });
    expect(
      screen.getByRole('link', { name: en('engagements.list.filter.mine') }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.queryByRole('navigation', { name: en('engagements.list.pages') })).toBeNull();
  });

  test('a partial My move says how many it looked through, in Latin digits', () => {
    renderList({ mine: true, truncatedAt: 200 });
    expect(screen.getByText('Showing the 200 newest open deliveries only.')).toBeTruthy();
  });

  test('an empty My move says nothing is waiting, not "start a delivery"', () => {
    renderList({ mine: true, items: [] });
    expect(screen.getByText(en('engagements.list.mineEmpty'))).toBeTruthy();
    expect(screen.queryByText(en('engagements.empty'))).toBeNull();
  });
});
