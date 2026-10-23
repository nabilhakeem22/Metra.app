// A builder line as the studio sees it: the unit by its name in the page's
// language (the code stays the value), and stored scale-4 figures without the
// trailing zeros that narrow boxes used to cut off.
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import type { LineState } from './builder-model';
import { BuilderLineRow } from './builder-line-row';
import { useUnitLabel } from '@/hooks/use-unit-label';
import type { DraftCellError } from './use-draft-field-errors';

const STORED_LINE: LineState = {
  key: 'line-1',
  id: 'l-1',
  costItemId: null,
  descriptionEn: 'Wardrobes',
  descriptionAr: '',
  qty: '18.0000',
  unit: 'linear_meter',
  unitCost: '9500.0000',
  unitPrice: '13200.5000',
  discountPct: '0.0000',
};

const NO_REFUSAL: DraftCellError = { message: undefined, clear: () => undefined };

function renderLine(locale: TestLocale, line: LineState = STORED_LINE) {
  const patchLine = vi.fn();
  renderWithIntl(
    <table>
      <tbody>
        <BuilderLineRow
          line={line}
          sectionIndex={0}
          lineIndex={0}
          seeMargin
          patchLine={patchLine}
          removeLine={vi.fn()}
          cellOf={() => NO_REFUSAL}
        />
      </tbody>
    </table>,
    { locale },
  );
  const box = (cell: string) => document.querySelector<HTMLInputElement>(`[data-draft-input="${cell}"]`)!;
  return { patchLine, box };
}

describe.each<TestLocale>(['ar-EG', 'en'])('a builder line (%s)', (locale) => {
  it('names the unit in the page language, never by its code', () => {
    renderLine(locale);
    const unit = document.getElementById('line-line-1-unit')!;
    expect(unit.textContent).toBe(messageAt(locale, 'priceBook.units.linear_meter'));
    expect(unit.textContent).not.toContain('linear_meter');
  });

  it('shows stored figures without trailing zeros, and leaves the line as stored', () => {
    const { box, patchLine } = renderLine(locale);
    expect(box('qty').value).toBe('18');
    expect(box('unitCost').value).toBe('9500');
    expect(box('unitPrice').value).toBe('13200.5');
    expect(box('discountPct').value).toBe('0');

    fireEvent.focus(box('unitPrice'));
    fireEvent.blur(box('unitPrice'));
    expect(box('unitPrice').value).toBe('13200.5');
    expect(patchLine).not.toHaveBeenCalled();
  });
});

function UnitName({ unit }: { unit: string }) {
  return <span data-testid="unit">{useUnitLabel()(unit)}</span>;
}

describe('a unit with no name yet in the catalogue', () => {
  it('shows its code rather than breaking the page', () => {
    renderWithIntl(<UnitName unit="barrel" />, { locale: 'ar-EG' });
    expect(document.querySelector('[data-testid="unit"]')!.textContent).toBe('barrel');
  });
});
