import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BudgetCard } from './budget-card';

// The server action is replaced, so no server-only stack is loaded.
const actions = vi.hoisted(() => ({ recordDeliveryAction: vi.fn() }));
vi.mock('../actions', () => actions);

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const ROM = { low: '900000.0000', high: '1200000.0000' };

/** The budget range's parts (figures, words, currency) in DOM order. */
function rangeParts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-part]')].map((part) => part.textContent ?? '');
}

function renderCard(rom: { low: string | null; high: string | null } | null, locale: TestLocale) {
  return renderWithIntl(<BudgetCard token="tok" rom={rom} />, { locale });
}

beforeEach(() => {
  actions.recordDeliveryAction.mockReset();
});

describe('BudgetCard', () => {
  it('shows the issued range, the currency label once, and the button (en)', () => {
    const { container } = renderCard(ROM, 'en');
    const text = container.textContent ?? '';
    expect(text).toContain(messageAt('en', 'delivery.budget.title'));
    expect(text).toContain(messageAt('en', 'delivery.budget.preparedBy'));
    expect(text.match(/EGP/g)).toHaveLength(1);
    expect(text).not.toContain('.00');
    expect(text).toContain(messageAt('en', 'delivery.budget.note'));
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeTruthy();
    // English reads left to right: EGP 900,000 to 1,200,000.
    expect(rangeParts(container)).toEqual([
      'EGP',
      '900,000',
      messageAt('en', 'delivery.budget.to'),
      '1,200,000',
    ]);
  });

  it('orders the Arabic range for a right-to-left reader: low, to, high, then the currency', () => {
    const { container } = renderCard(ROM, 'ar-EG');
    // The row follows the document direction (no forced ltr), so DOM order IS the
    // right-to-left reading order, ending with ج.م at the far left.
    const row = container.querySelector('[data-part]')?.parentElement as HTMLElement;
    expect(row.hasAttribute('dir')).toBe(false);
    expect(rangeParts(container)).toEqual([
      '900,000',
      messageAt('ar-EG', 'delivery.budget.to'),
      '1,200,000',
      'ج.م',
    ]);
    // Each figure is its own left-to-right isolate, Latin digits.
    const figures = container.querySelectorAll('bdi[data-part="figure"]');
    expect([...figures].map((figure) => figure.getAttribute('dir'))).toEqual(['ltr', 'ltr']);
    expect(ARABIC_INDIC.test(container.textContent ?? '')).toBe(false);
  });

  it('records acknowledge_rom and shows the confirmed state instead of the button', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: true });
    const { container } = renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));

    const confirmed = await screen.findByRole('status');
    expect(confirmed.textContent).toContain(messageAt('en', 'delivery.budget.acknowledged'));
    expect(actions.recordDeliveryAction).toHaveBeenCalledWith('tok', 'acknowledge_rom');
    expect(confirmed.textContent).not.toContain(messageAt('en', 'delivery.budget.acknowledgedNotified'));
    expect(screen.queryByRole('button')).toBeNull();
    // The range stays on screen after acknowledging.
    expect(container.textContent).toContain('1,200,000');
  });

  it('says the team was notified only when the studio really was', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: true, studioNotified: true });
    renderCard(ROM, 'ar-EG');
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.budget.acknowledge') }));
    const confirmed = await screen.findByRole('status');
    expect(confirmed.textContent).toContain(messageAt('ar-EG', 'delivery.budget.acknowledgedNotified'));
  });

  it('paints the confirmed state with theme tokens, never a fixed light palette', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: true });
    const { container } = renderCard(ROM, 'ar-EG');
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.budget.acknowledge') }));
    const confirmed = await screen.findByRole('status');
    expect(confirmed.className).toContain('var(--success');
    expect(container.innerHTML).not.toMatch(/emerald|amber/);
  });

  it('shows a known error for an unknown failure code, and the button stays', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: false, error: 'contract_inactive' });
    renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(messageAt('en', 'delivery.actions.error.generic'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeTruthy(),
    );
  });

  it('recovers from a rejected action without a stuck spinner', async () => {
    actions.recordDeliveryAction.mockRejectedValue(new Error('network'));
    renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.actions.error.generic'),
    );
    await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
  });

  it('shows a lone low bound as a "from" figure and a lone high bound as "up to"', () => {
    const low = renderCard({ low: '900000.0000', high: null }, 'en');
    expect(rangeParts(low.container)).toEqual([
      messageAt('en', 'delivery.budget.from'),
      'EGP',
      '900,000',
    ]);
    low.unmount();

    const high = renderCard({ low: null, high: '1200000.0000' }, 'ar-EG');
    expect(rangeParts(high.container)).toEqual([
      messageAt('ar-EG', 'delivery.budget.upTo'),
      '1,200,000',
      'ج.م',
    ]);
  });

  it('keeps 2 decimals on a bound that is not whole', () => {
    const { container } = renderCard({ low: '900000.5000', high: '1200000.0000' }, 'en');
    expect(rangeParts(container)).toEqual([
      'EGP',
      '900,000.50',
      messageAt('en', 'delivery.budget.to'),
      '1,200,000',
    ]);
  });

  it('asks without a figure when no band is issued', () => {
    const { container } = renderCard(null, 'en');
    expect(container.textContent).not.toMatch(/\d/);
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeTruthy();
  });
});
