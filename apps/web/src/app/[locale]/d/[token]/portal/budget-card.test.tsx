import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BudgetCard } from './budget-card';

// The server action is replaced, so no server-only stack is loaded.
const actions = vi.hoisted(() => ({ recordDeliveryAction: vi.fn() }));
vi.mock('../actions', () => actions);

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const ROM = { low: '900000.0000', high: '1200000.0000' };

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
    expect(text).toContain('900,000.00');
    expect(text).toContain('1,200,000.00');
    expect(text).toContain(messageAt('en', 'delivery.budget.to'));
    expect(text.match(/EGP/g)).toHaveLength(1);
    expect(text).toContain(messageAt('en', 'delivery.budget.note'));
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeTruthy();
  });

  it('keeps the figures Latin and left-to-right in Arabic', () => {
    const { container } = renderCard(ROM, 'ar-EG');
    const text = container.textContent ?? '';
    expect(text).toContain('900,000.00');
    expect(text).toContain('ج.م');
    expect(text).toContain(messageAt('ar-EG', 'delivery.budget.to'));
    expect(ARABIC_INDIC.test(text)).toBe(false);
    expect(container.querySelector('p[dir="ltr"]')?.textContent).toContain('1,200,000.00');
  });

  it('records acknowledge_rom and shows the confirmed state instead of the button', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: true });
    const { container } = renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));

    const confirmed = await screen.findByRole('status');
    expect(confirmed.textContent).toContain(messageAt('en', 'delivery.budget.acknowledged'));
    expect(actions.recordDeliveryAction).toHaveBeenCalledWith('tok', 'acknowledge_rom');
    expect(screen.queryByRole('button')).toBeNull();
    // The range stays on screen after acknowledging.
    expect(container.textContent).toContain('1,200,000.00');
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
    const fromPrefix = messageAt('en', 'delivery.budget.atLeast').replace('{amount}', '');
    expect(low.container.textContent).toContain(fromPrefix.trim());
    expect(low.container.textContent).toContain('900,000.00 EGP');
    low.unmount();

    const high = renderCard({ low: null, high: '1200000.0000' }, 'ar-EG');
    const upToPrefix = messageAt('ar-EG', 'delivery.budget.atMost').replace('{amount}', '');
    expect(high.container.textContent).toContain(upToPrefix.trim());
    expect(high.container.textContent).toContain('1,200,000.00 ج.م');
  });

  it('asks without a figure when no band is issued', () => {
    const { container } = renderCard(null, 'en');
    expect(container.textContent).not.toMatch(/\d/);
    expect(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeTruthy();
  });
});
