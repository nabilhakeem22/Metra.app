import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PublicContract } from '@/lib/contracts/public-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { PublicContractView } from './public-contract';

// A3 F3 and F4 on the page: a signed contract says the Cairo day it was signed
// and how, in فصحى, and a paper signature is never said as the client's own
// electronic acknowledgement.

vi.mock('./actions', () => ({ acknowledgeContract: vi.fn(), loadContractSectionLines: vi.fn(), loadContractSections: vi.fn() }));

const ORG = { name_ar: 'ستوديو', name_en: 'Studio', logo_file_id: null };
const signedContract = (via: 'paper' | 'online') =>
  ({
    number: 7, status: 'signed', title_ar: null, title_en: 'Fit-out', total: '114', advance_pct: '0',
    retention_pct: '0', org: ORG, sections: [], section_count: 0, source: 'boq', payment_schedule: [],
    signed: { on: '2026-10-15', via },
  }) as unknown as PublicContract;

describe.each<TestLocale>(['en', 'ar-EG'])('a signed contract on /c (%s)', (locale) => {
  test.each(['paper', 'online'] as const)('signed %s: the day and the way, with no acknowledgement box', (via) => {
    renderWithIntl(<PublicContractView token="t" contract={signedContract(via)} />, { locale });
    const key = via === 'paper' ? 'contracts.ack.signedPaper' : 'contracts.ack.signedOnline';
    expect(screen.getByText(messageAt(locale, key).replace('{date}', '15/10/2026'))).toBeTruthy();
    expect(screen.queryByText(messageAt(locale, 'contracts.ack.done'))).toBeNull();
    expect(screen.queryByRole('button', { name: messageAt(locale, 'contracts.ack.button') })).toBeNull();
  });
});
