// F1: line discounts appear on the sheet ONLY when the studio gave one.
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqSheet } from './boq-sheet';

// 'use server' module: replaced, so no server-only stack is loaded.
vi.mock('@/lib/boqs/actions', () => ({
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  deleteBoqLine: vi.fn(),
  setBoqDiscount: vi.fn(),
  updateBoqLine: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const en = (path: string) => messageAt('en', path);

const line = (id: string, unitPrice: string, discountPct: string, lineTotal: string) => ({
  id,
  itemCode: null,
  description: `Line ${id}`,
  unit: 'sqm',
  qty: '10.0000',
  unitPrice,
  discountPct,
  lineTotal,
  provisional: false,
});

/** Issued, two lines; the second at `secondDiscount` percent off a 1,000.00 gross. */
function boq(secondDiscount: string, secondTotal: string, subtotal: string): BoqDetail {
  return {
    id: 'boq-1',
    number: 7,
    version: 1,
    title: 'BOQ',
    status: 'issued',
    source: 'built',
    currency: 'EGP',
    discountPct: '0',
    subtotal,
    discountAmount: '0.0000',
    total: subtotal,
    lineCount: 2,
    sections: [
      {
        id: 's-1',
        title: 'Ceilings',
        sectionSubtotal: subtotal,
        lines: [
          line('a', '200.0000', '0.0000', '2000.0000'),
          line('b', '100.0000', secondDiscount, secondTotal),
        ],
      },
    ],
  };
}

function renderSheet(detail: BoqDetail) {
  return renderWithIntl(<BoqSheet boq={detail} canEdit={false} />, { locale: 'en' });
}

describe('the BOQ sheet and line discounts (F1)', () => {
  it('has NO discount column and no line-discount rows when no line is discounted', () => {
    const { container } = renderSheet(boq('0.0000', '1000.0000', '3000.0000'));
    expect(screen.queryByRole('columnheader', { name: en('projects.profile.boq.col.discount') })).toBeNull();
    expect(screen.queryByText(en('projects.profile.boq.lineDiscounts'))).toBeNull();
    expect(screen.getByText(en('projects.profile.boq.subtotal'))).toBeTruthy();
    expect(container.textContent).not.toContain('%');
  });

  it('shows the % column for every line and totals that subtract to the subtotal', () => {
    // 10% off line b: 1,000.00 gross, 100.00 off, 900.00 stored. Subtotal 2,900.00.
    renderSheet(boq('10.0000', '900.0000', '2900.0000'));
    expect(screen.getByRole('columnheader', { name: en('projects.profile.boq.col.discount') })).toBeTruthy();
    expect(screen.getByText('10.00%')).toBeTruthy();
    expect(screen.getByText('0.00%')).toBeTruthy();

    const rowOf = (label: string) => screen.getByText(label).closest('tr')!;
    expect(within(rowOf(en('projects.profile.boq.grossBeforeDiscounts'))).getByText(/3,000\.00/)).toBeTruthy();
    expect(within(rowOf(en('projects.profile.boq.lineDiscounts'))).getByText(/100\.00/)).toBeTruthy();
    expect(
      within(rowOf(en('projects.profile.boq.subtotalAfterLineDiscounts'))).getByText(/2,900\.00/),
    ).toBeTruthy();
  });

  it('widens the section band and totals so their figures stay in the Amount column', () => {
    renderSheet(boq('10.0000', '900.0000', '2900.0000'));
    const band = screen.getByText('Ceilings').closest('td')!;
    expect(band.getAttribute('colspan')).toBe('6');
    const total = screen.getByText(en('projects.profile.boq.total'), { selector: 'span' }).closest('td')!;
    expect(total.getAttribute('colspan')).toBe('6');
  });
});
