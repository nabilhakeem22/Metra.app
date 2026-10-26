import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractTotalsCard } from './totals-card';

// H6-read F3: an execution contract with a BOQ-level discount says it, on /c
// and in the client home, so the sections' subtotals (201,052,257.62) and the
// works value (190,999,644.74) add up: one row between them.

const DISCOUNTED: ContractDocument = {
  id: '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0001',
  source: 'boq',
  discount_pct: '5.0000',
  discount_amount: '10052612.8800',
  taxable_base: '190999644.7400',
  tax_rate: '14.0000',
  tax_amount: '26739950.2600',
  supervision_pct: '10.0000',
  supervision_amount: '19099964.4700',
  original_value: '236839559.4700',
  total: '236839559.4700',
  advance_pct: '0.0000',
  retention_pct: '0.0000',
  payment_schedule: [],
  section_count: 0,
  sections: [],
};

const rows = () => [...document.querySelectorAll('.flex.justify-between')].map((row) => (row as HTMLElement).textContent);
const discountLabel = (locale: TestLocale) => messageAt(locale, 'portal.contract.totals.discount').replace('{rate}', '5.00%');

describe.each<TestLocale>(['en', 'ar-EG'])('the contract figures (%s)', (locale) => {
  test('a BOQ discount is a row before the works value, with its rate and amount', () => {
    renderWithIntl(<ContractTotalsCard contract={DISCOUNTED} />, { locale });
    const shown = rows();
    expect(shown[0]).toBe(`${discountLabel(locale)}10,052,612.88 ${locale === 'en' ? 'EGP' : 'ج.م'}`);
    expect(shown[1]).toContain(messageAt(locale, 'portal.contract.totals.worksValue'));
    expect(screen.getAllByText(/10,052,612\.88/)).toHaveLength(1);
  });

  test('no discount, no row', () => {
    renderWithIntl(<ContractTotalsCard contract={{ ...DISCOUNTED, discount_pct: '0.0000', discount_amount: '0.0000' }} />, { locale });
    expect(rows()).toHaveLength(4);
    expect(screen.queryByText(discountLabel(locale))).toBeNull();
  });
});
