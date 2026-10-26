import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { renderWithIntl } from '@/test/render-with-intl';
import { ContractScheduleCard } from './schedule-card';

// H6-read F2: an 80-character unbroken schedule label breaks inside its cell
// rather than scroll the client's page sideways; the share and the amount keep
// their one line.

const CONTRACT = {
  original_value: '1000.0000',
  tax_amount: '140.0000',
  payment_schedule: [{ label_ar: null, label_en: 'L'.repeat(80), basis: 'percent', value: '100.0000', sort_order: 0 }],
} as unknown as ContractDocument;

describe('a long unbroken schedule label', () => {
  test('breaks in its own cell; the share and the amount never break', () => {
    renderWithIntl(<ContractScheduleCard contract={CONTRACT} />, { locale: 'en' });
    const [label, share, amount] = screen.getAllByRole('cell');
    expect(label.textContent).toBe('L'.repeat(80));
    expect(label.className.split(' ')).toContain('[overflow-wrap:anywhere]');
    for (const figure of [share, amount]) expect(figure.className.split(' ')).toContain('whitespace-nowrap');
  });
});
