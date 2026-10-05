// AC23: in the project's Proposals tab a delivery's BOQ working copy shows the
// "BOQ" tag IN PLACE OF a Q- number; a quote keeps its number.
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ProposalsTab } from './proposals-tab';

// A server component: its next-intl/server reads are replaced so it can be
// awaited here; the tag inside it is a client-safe component rendered for real.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
  getLocale: async () => 'en',
}));

const row = (over: Partial<ProposalListRow>): ProposalListRow =>
  ({
    id: 'p-1',
    number: 3,
    kind: 'quote',
    status: 'draft',
    titleAr: null,
    titleEn: 'Kitchen',
    total: '1000.0000',
    issueDate: '2026-02-01',
    createdAt: '2026-02-01T00:00:00Z',
    ...over,
  }) as ProposalListRow;

describe('ProposalsTab number cell (AC23)', () => {
  it('tags the BOQ working copy and renders no Q- number for it', async () => {
    const tab = await ProposalsTab({
      projectId: 'pr-1',
      canBuild: false,
      proposals: [
        row({ id: 'boq', number: 9, kind: 'boq', titleEn: 'Bill of Quantities' }),
        row({ id: 'quote', number: 3 }),
      ],
    });
    const { container } = renderWithIntl(tab, { locale: 'en' });
    expect(screen.getByText(messageAt('en', 'proposals.kindTag.boq'))).toBeTruthy();
    expect(container.textContent).toContain('Q-2026-0003');
    expect(container.textContent).not.toContain('Q-2026-0009');
  });
});
