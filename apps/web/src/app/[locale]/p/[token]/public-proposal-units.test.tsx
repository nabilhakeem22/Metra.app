import { COST_ITEM_UNITS } from '@metra/db';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scopedMessages } from '@/i18n/client-namespaces';
import type { PublicProposal } from '@/lib/proposals/public';
import { messageAt, messagesFor, type TestLocale } from '@/test/render-with-intl';
import { PublicProposalView } from './public-proposal';

// The client's proposal page printed each line's raw unit code ("sqm",
// "linear_meter"). It names the unit in the client's language, from the /p
// scope's own messages (portal.units), for every unit a line can carry.

vi.mock('./actions', () => ({ respondToProposal: vi.fn() }));

afterEach(cleanup);

const line = (unit: string, index: number) => ({
  id: `line-${index}`, description_ar: `بند ${unit}`, description_en: `Line ${unit}`, qty: '2', unit,
  unit_price: '10.0000', discount_pct: '0', line_total: '20.0000', sort_order: index,
});

const PROPOSAL = {
  id: 'proposal-1', number: 7, status: 'sent', title_ar: 'عرض', title_en: 'Proposal', currency: 'EGP',
  issue_date: '2026-10-01', expiry_date: null, discount_pct: '0', tax_rate: '14', subtotal: '20.0000',
  discount_amount: '0', taxable_base: '20.0000', tax_amount: '2.8000', total: '22.8000',
  notes_ar: null, notes_en: null, terms_ar: null, terms_en: null, share_expires_at: null,
  org: { name_ar: 'استوديو', name_en: 'Studio', logo_file_id: null },
  sections: [{
    id: 'section-1', title_ar: 'قسم', title_en: 'Section', section_subtotal: '20.0000', sort_order: 1,
    lines: [...COST_ITEM_UNITS, 'not_a_unit'].map(line),
  }],
} satisfies PublicProposal;

/** The page as /p renders it: only the proposalLink scope's messages, and a missing key fails the test. */
function renderPage(locale: TestLocale) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={scopedMessages(messagesFor(locale), 'proposalLink')}
      timeZone="UTC"
      onError={(error) => {
        throw error;
      }}
    >
      <PublicProposalView token="token" proposal={PROPOSAL} />
    </NextIntlClientProvider>,
  );
}

/** The quantity cell of the line whose description is `description`. */
const quantityCellOf = (description: string) => screen.getByText(description).closest('tr')?.querySelectorAll('td')[1]?.textContent;

describe.each<[TestLocale, string]>([['ar-EG', 'بند'], ['en', 'Line']])('the client proposal page in %s', (locale, linePrefix) => {
  it.each([...COST_ITEM_UNITS])('names unit %s in the client language, never the code', (unit) => {
    renderPage(locale);
    const name = messageAt(locale, `portal.units.${unit}`);
    const cell = quantityCellOf(`${linePrefix} ${unit}`);
    expect(cell).toBe(`2 ${name}`);
    if (name !== unit) expect(cell).not.toContain(unit);
  });

  it('shows a unit the catalogue does not name as stored', () => {
    renderPage(locale);
    expect(quantityCellOf(`${linePrefix} not_a_unit`)).toBe('2 not_a_unit');
  });
});
