import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PublicContract } from '@/lib/contracts/public-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PublicContractView } from './public-contract';

// A3 F3 and F4 on the page: a signed contract says the Cairo day it was signed
// and how, in فصحى, and a paper signature is never said as the client's own
// electronic acknowledgement. H6.3 (AC7): an issued BOQ contract is signed in
// the client home, so its link shows the document and says where it is signed
// now, with no acknowledgement box; a proposal contract keeps the box (OD3).

vi.mock('./actions', () => ({ acknowledgeContract: vi.fn(), loadContractSectionLines: vi.fn(), loadContractSections: vi.fn() }));

const ORG = { name_ar: 'ستوديو', name_en: 'Studio', logo_file_id: null };
const SECTION = { id: 's-1', title_ar: 'أعمال الجبس', title_en: 'Gypsum works', section_subtotal: '100', sort_order: 0, line_count: 0, lines: [] };
const contractOf = (source: 'boq' | 'proposal', status: string, signed: PublicContract['signed'] = null) =>
  ({
    number: 7, status, title_ar: null, title_en: 'Fit-out', total: '114', advance_pct: '0', retention_pct: '0',
    original_value: '100', tax_amount: '14', taxable_base: '100', tax_rate: '14', supervision_pct: '0',
    supervision_amount: '0', discount_pct: '0', discount_amount: '0', org: ORG, sections: [SECTION], section_count: 1,
    source, signed,
    payment_schedule: [{ label_ar: 'دفعة التعاقد', label_en: 'On signing', basis: 'percent', value: '100', sort_order: 0 }],
  }) as unknown as PublicContract;

describe.each<TestLocale>(['en', 'ar-EG'])('a signed contract on /c (%s)', (locale) => {
  test.each(['paper', 'online'] as const)('signed %s: the day and the way, with no acknowledgement box', (via) => {
    renderWithIntl(<PublicContractView token="t" contract={contractOf('boq', 'signed', { on: '2026-10-15', via })} />, { locale });
    const key = via === 'paper' ? 'contracts.ack.signedPaper' : 'contracts.ack.signedOnline';
    expect(screen.getByText(messageAt(locale, key).replace('{date}', '15/10/2026'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'contracts.ack.done'))).toBeNull();
    expect(screen.queryByRole('button', { name: messageAt(locale, 'contracts.ack.button') })).toBeNull();
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('an issued contract on /c (%s)', (locale) => {
  const studio = locale === 'en' ? 'Studio' : 'ستوديو';
  const at = (key: string) => messageAt(locale, key);

  test('BOQ: the document, and where it is signed now; no name box, no button, no notSignature line', () => {
    const { container } = renderWithIntl(<PublicContractView token="t" contract={contractOf('boq', 'issued')} />, { locale });
    expect(container.querySelector('[data-sign-in-home]')?.textContent).toBe(at('contracts.ack.signInHome').replaceAll('{studio}', studio));
    expect(screen.queryByRole('button', { name: at('contracts.ack.button') })).toBeNull();
    expect(screen.queryByLabelText(at('contracts.ack.nameLabel'))).toBeNull();
    expect(screen.queryByText(at('contracts.ack.notSignature'))).toBeNull();
    expect(screen.getByText(locale === 'en' ? 'Gypsum works' : 'أعمال الجبس')).toBeTruthy();
    expect(screen.getByText(at('portal.contract.totals.originalValue'))).toBeTruthy();
    expect(screen.getByText(at('portal.contract.schedule.title'))).toBeTruthy();
  });

  test('proposal: the name box and the acknowledge button, as before', () => {
    const { container } = renderWithIntl(<PublicContractView token="t" contract={contractOf('proposal', 'issued')} />, { locale });
    expect(container.querySelector('[data-sign-in-home]')).toBeNull();
    expect(screen.getByRole('button', { name: at('contracts.ack.button') })).toBeTruthy();
    expect(screen.getByLabelText(at('contracts.ack.nameLabel'))).toBeTruthy();
    expect(screen.getByText(at('contracts.ack.notSignature'))).toBeTruthy();
  });
});
