import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyExact } from '@/lib/format/money';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ChangeOrderChargeRows } from './charge-rows';

// H7.1: what an order costs and the time it adds, moved out of /v's card so the
// client home shows the same rows; its wording in portal.changeOrder.

const ORDER = { net_delta: '10000.0000', charges: { taxRate: '14.0000', supervisionPct: '10.0000' }, timeExtensionDays: 7, finish: null };

describe.each<TestLocale>(['ar-EG', 'en'])('the charge rows (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, `portal.changeOrder.${key}`);
  const show = (variation: Parameters<typeof ChangeOrderChargeRows>[0]['variation'], standing: string | null = 'issued') =>
    renderWithIntl(<ChangeOrderChargeRows variation={variation} standing={standing} m={(value) => formatMoney(value, locale)} />, { locale });

  it('works, VAT, supervision and the total, exact, and the days it would add', () => {
    const { container } = show(ORDER);
    for (const key of ['works', 'tax', 'supervision', 'total']) expect(screen.getByText(at(`charge.${key}`))).toBeTruthy();
    expect(container.textContent).toContain(formatMoneyExact('12400.0000', locale));
    expect(container.textContent).toContain('7');
  });

  it('no rates: the net change alone', () => {
    show({ ...ORDER, charges: null, timeExtensionDays: null });
    expect(screen.getByText(at('netDelta'))).toBeTruthy();
    expect(screen.queryByText(at('charge.total'))).toBeNull();
  });

  it('closed any other way: no days said', () => {
    const { container } = show({ ...ORDER, charges: null }, null);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('approved days on the contract: the revised finish, or only the days with no end date', () => {
    const dated = show({ ...ORDER, finish: { endDate: '2027-02-28', approvedExtensionDays: 5 } });
    expect(dated.container.textContent).toContain('2027');
    dated.unmount();
    const undated = show({ ...ORDER, finish: { endDate: null, approvedExtensionDays: 5 } });
    expect(undated.container.textContent).not.toContain('2027');
    expect(undated.container.querySelectorAll('p')).toHaveLength(2);
  });
});
