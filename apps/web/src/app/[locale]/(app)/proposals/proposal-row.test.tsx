import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { ProposalRow } from './proposal-row';

const row = (over: Partial<ProposalListRow> = {}): ProposalListRow => ({
  id: 'p-1',
  number: 12,
  titleAr: null,
  titleEn: 'Bill of Quantities',
  status: 'draft',
  kind: 'quote',
  total: '1000.0000',
  currency: 'EGP',
  issueDate: '2026-03-01',
  createdAt: '2026-03-01T00:00:00.000Z',
  clientNameEn: 'Acme',
  clientNameAr: null,
  projectNameEn: 'Villa',
  projectNameAr: null,
  ...over,
});

function renderRow(data: ProposalListRow) {
  return renderWithIntl(
    <table>
      <tbody>
        <ProposalRow row={data} />
      </tbody>
    </table>,
    { locale: 'en' },
  );
}

describe('ProposalRow (AC23)', () => {
  it('a quote shows its Q- number', () => {
    renderRow(row());
    expect(screen.getByText('Q-2026-0012')).toBeTruthy();
  });

  it('a BOQ working copy shows the BOQ tag and never a Q- number', () => {
    const { container } = renderRow(row({ kind: 'boq' }));
    expect(screen.getByText(messageAt('en', 'proposals.kindTag.boq'))).toBeTruthy();
    expect(container.textContent).not.toMatch(/Q-\d{4}-\d{4}/);
    expect(screen.getByRole('link').getAttribute('href')).toContain('/proposals/p-1');
  });
});
