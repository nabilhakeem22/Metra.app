import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { PublicContractLine } from '@/lib/contracts/public-types';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ContractLineRow } from './line-row';

// H6.1: a client contract line names its unit in the client's language through
// the client unit helper (portal.units, never the stored code), keeps every
// stored decimal of its quantity up to 4 (the app's quantity rule), and stacks
// on a narrow list so a phone never scrolls sideways.

const LINE: PublicContractLine = {
  id: 'l-1',
  item_code: '1.1',
  description_ar: 'هدم بلاط الأرضيات',
  description_en: 'Strip the floor tiles',
  qty: '12.3456',
  unit: 'linear_meter',
  unit_price: '65.0000',
  discount_pct: '0.0000',
  line_total: '802.4640',
  provisional: false,
  sort_order: 1,
};

function renderRow(line: PublicContractLine, locale: TestLocale) {
  return renderWithIntl(
    <table>
      <tbody>
        <ContractLineRow line={line} />
      </tbody>
    </table>,
    { locale },
  );
}

const cells = () => screen.getAllByRole('cell').map((cell) => cell.textContent);

describe.each<TestLocale>(['en', 'ar-EG'])('a client contract line (%s)', (locale) => {
  test('the unit is named in the client words, never the stored code', () => {
    renderRow(LINE, locale);
    expect(cells()[1]).toBe(`12.3456 ${messageAt(locale, 'portal.units.linear_meter')}`);
    expect(screen.queryByText(/linear_meter/)).toBeNull();
  });

  test('a code with no name yet shows as the code rather than breaking the line', () => {
    renderRow({ ...LINE, unit: 'pallet' }, locale);
    expect(cells()[1]).toBe('12.3456 pallet');
  });

  test.each([
    ['12.3456', '12.3456'],
    ['0.0001', '0.0001'],
    ['0.1250', '0.125'],
    ['1.0000', '1'],
    ['1234.5000', '1,234.5'],
  ])('quantity %s reads %s: up to 4 decimals, none rounded away, none forced', (qty, shown) => {
    renderRow({ ...LINE, qty, unit: 'sqm' }, locale);
    expect(cells()[1]).toBe(`${shown} ${messageAt(locale, 'portal.units.sqm')}`);
  });

  test('the item code is its own run, apart from the description', () => {
    renderRow(LINE, locale);
    const code = screen.getByText('1.1');
    expect(code.getAttribute('dir')).toBe('ltr');
    expect(code.parentElement?.className).toContain('me-2');
    expect(code.parentElement?.hasAttribute('dir')).toBe(false);
  });
});

describe('the 390 px layout', () => {
  test('a narrow list stacks the line; from 36rem of its width it is a table row', () => {
    renderRow(LINE, 'ar-EG');
    const row = screen.getByRole('row');
    expect(row.className.split(' ')).toEqual(expect.arrayContaining(['grid', '[@container(min-width:36rem)]:table-row']));
    const [description, quantity, unitPrice, total] = screen.getAllByRole('cell');
    expect(description.className).toContain('col-span-2');
    expect(unitPrice.className).toContain('row-start-3');
    expect(total.className).toContain('row-span-2');
    for (const figure of [quantity, unitPrice, total]) expect(figure.className).toContain('whitespace-nowrap');
  });
});
