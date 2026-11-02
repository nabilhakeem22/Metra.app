import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H7.1 (OD-3): an order's items load on the first tap and toggle after it; one
// read at a time; a refused read says why and leaves the button free.

vi.mock('server-only', () => ({}));
const actions = vi.hoisted(() => ({ loadChangeOrderLines: vi.fn() }));
vi.mock('../variation-actions', () => actions);

const { ChangeOrderLines } = await import('./change-order-lines');

const ORDER = '22222222-2222-4222-8222-222222222222';
const LINE = { id: 'l-1', item_code: null, description_ar: 'بورسلين', description_en: 'Porcelain', qty: '2.0000', unit: 'm2', unit_price: '500.0000', discount_pct: '0.0000', line_total: '1000.0000', provisional: false, sort_order: 1 };

beforeEach(() => {
  actions.loadChangeOrderLines.mockReset().mockResolvedValue({ ok: true, lines: [LINE] });
});

describe.each<TestLocale>(['ar-EG', 'en'])('the items of a change order (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, `delivery.changeOrders.lines.${key}`);
  const show = () => screen.getByRole('button', { name: at('show').replace('{count}', '3') });
  const description = locale === 'en' ? 'Porcelain' : 'بورسلين';
  const mount = () => renderWithIntl(<ChangeOrderLines token="tok" variationId={ORDER} lineCount={3} />, { locale });

  it('none with the page; the first tap reads once, even a double tap; later taps toggle and read nothing', async () => {
    mount();
    expect(screen.queryByText(description)).toBeNull();
    expect(actions.loadChangeOrderLines).not.toHaveBeenCalled();
    const button = show();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(actions.loadChangeOrderLines).toHaveBeenCalledTimes(1);
    expect(actions.loadChangeOrderLines).toHaveBeenCalledWith('tok', ORDER);
    expect(screen.getByText(description)).toBeTruthy();
    const hide = screen.getByRole('button', { name: at('hide') });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(hide);
    expect(show().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show());
    expect(actions.loadChangeOrderLines).toHaveBeenCalledTimes(1);
  });

  it.each<[string, unknown, string]>([
    ['gone', { ok: false, error: 'gone' }, 'gone'],
    ['a rejected read', null, 'loadFailed'],
  ])('%s: says why, and the button is free again', async (_case, answer, key) => {
    if (answer) actions.loadChangeOrderLines.mockResolvedValueOnce(answer);
    else actions.loadChangeOrderLines.mockRejectedValueOnce(new Error('lost'));
    mount();
    await act(async () => fireEvent.click(show()));
    expect(screen.getByRole('alert').textContent).toBe(at(key));
    await act(async () => fireEvent.click(show()));
    expect(actions.loadChangeOrderLines).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(description)).toBeTruthy();
  });

  it('the read budget spent: the portal sentence', async () => {
    actions.loadChangeOrderLines.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    mount();
    await act(async () => fireEvent.click(show()));
    expect(screen.getByRole('alert').textContent).toContain(messageAt(locale, 'portal.errors.too_many'));
  });

  it('an order with no lines offers no button', () => {
    renderWithIntl(<ChangeOrderLines token="tok" variationId={ORDER} lineCount={0} />, { locale });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
