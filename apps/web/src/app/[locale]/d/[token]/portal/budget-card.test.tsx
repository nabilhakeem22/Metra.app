import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BudgetCard } from './budget-card';

// The server action is replaced, so no server-only stack is loaded.
const actions = vi.hoisted(() => ({ acknowledgeDeliveryBudget: vi.fn() }));
vi.mock('../review-actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const ROM = { low: '900000.0000', high: '1200000.0000' };

/** The budget range's parts (figures, words, currency) in DOM order. */
function rangeParts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-part]')].map((part) => part.textContent ?? '');
}

function renderCard(
  rom: { low: string | null; high: string | null },
  locale: TestLocale,
  canAcknowledge = true,
) {
  return renderWithIntl(<BudgetCard token="tok" rom={rom} canAcknowledge={canAcknowledge} acknowledgedAt={null} prominent />, { locale });
}

beforeEach(() => {
  actions.acknowledgeDeliveryBudget.mockReset();
  router.refresh.mockReset();
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

  it('records acknowledge_rom, keeps the range with "you have seen it", and re-reads the page', async () => {
    actions.acknowledgeDeliveryBudget.mockResolvedValue({ kind: 'acknowledged', studioNotified: false });
    const { container } = renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));

    const confirmed = await screen.findByRole('status');
    expect(confirmed.textContent).toContain(messageAt('en', 'delivery.budget.acknowledgedNote'));
    expect(confirmed.textContent).toContain(messageAt('en', 'delivery.budget.acknowledged'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // F1: the card sends the band it shows, so another band issued meanwhile writes nothing.
    expect(actions.acknowledgeDeliveryBudget).toHaveBeenCalledWith('tok', '900000.0000..1200000.0000');
    expect(confirmed.textContent).not.toContain(messageAt('en', 'delivery.budget.acknowledgedNotified'));
    expect(screen.queryByRole('button')).toBeNull();
    // The range stays on screen after acknowledging.
    expect(container.textContent).toContain('1,200,000');
  });

  it('says the team was notified only when the studio really was', async () => {
    actions.acknowledgeDeliveryBudget.mockResolvedValue({ kind: 'acknowledged', studioNotified: true });
    renderCard(ROM, 'ar-EG');
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.budget.acknowledge') }));
    const confirmed = await screen.findByRole('status');
    expect(confirmed.textContent).toContain(messageAt('ar-EG', 'delivery.budget.acknowledgedNotified'));
  });

  it('paints the confirmed state with theme tokens, never a fixed light palette', async () => {
    actions.acknowledgeDeliveryBudget.mockResolvedValue({ kind: 'acknowledged', studioNotified: false });
    const { container } = renderCard(ROM, 'ar-EG');
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.budget.acknowledge') }));
    const confirmed = await screen.findByRole('status');
    expect(confirmed.className).toContain('var(--success');
    expect(container.innerHTML).not.toMatch(/emerald|amber/);
  });

  it('shows the narrowed error, and the button stays', async () => {
    actions.acknowledgeDeliveryBudget.mockResolvedValue({ kind: 'error', error: 'generic' });
    renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(messageAt('en', 'delivery.actions.error.generic'));
    expect(router.refresh).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') })).toBeTruthy(),
    );
  });

  it('recovers from a rejected action without a stuck spinner', async () => {
    actions.acknowledgeDeliveryBudget.mockRejectedValue(new Error('network'));
    renderCard(ROM, 'en');
    fireEvent.click(screen.getByRole('button', { name: messageAt('en', 'delivery.budget.acknowledge') }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.actions.error.generic'),
    );
    await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
  });

  it('AC 28: not offered (already seen, or after a reload) the range stays, with no button', () => {
    const { container } = renderCard(ROM, 'ar-EG', false);
    expect(rangeParts(container)).toEqual(['900,000', messageAt('ar-EG', 'delivery.budget.to'), '1,200,000', 'ج.م']);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toContain(messageAt('ar-EG', 'delivery.budget.note'));
  });

  it('F1: another band issued since the card was drawn: says so, writes nothing, re-reads', async () => {
    actions.acknowledgeDeliveryBudget.mockResolvedValue({ kind: 'changed' });
    renderCard(ROM, 'ar-EG');
    fireEvent.click(screen.getByRole('button', { name: messageAt('ar-EG', 'delivery.budget.acknowledge') }));
    expect((await screen.findByRole('alert')).textContent).toBe(messageAt('ar-EG', 'delivery.actions.changed'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('F10: secondary while the hero holds the one filled button, filled otherwise', () => {
    const classOf = (prominent: boolean) =>
      renderWithIntl(<BudgetCard token="tok" rom={ROM} canAcknowledge acknowledgedAt={null} prominent={prominent} />, { locale: 'en' })
        .container.querySelector('button')!.className;
    expect(classOf(false)).toContain('bg-[color:var(--glass-btn)]');
    expect(classOf(false)).not.toContain('bg-[image:var(--brand-grad)]');
    expect(classOf(true)).toContain('bg-[image:var(--brand-grad)]');
  });
});
