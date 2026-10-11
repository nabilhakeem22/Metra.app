import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignWithBudgetOutcome } from '@/lib/engagements/review-outcome';
import { answerDialog, renderCommandCard } from '@/test/portal-command-card';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// Round D, AC S10: the one-tap approve+budget on the page. The design approval
// and the budget acknowledgement are two consents; the hero says what became
// of the budget half, in both locales, through the real catalogues (a missing
// key throws), with no dash and Latin digits only.

const actions = vi.hoisted(() => ({
  chooseDeliveryConcept: vi.fn(),
  respondToDeliveryConcept: vi.fn(),
  respondToDeliveryDesign: vi.fn(),
  approveDesignWithBudget: vi.fn(),
  acknowledgeDeliveryHandover: vi.fn(),
}));
vi.mock('../review-actions', () => actions);
vi.mock('../actions', () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const DESIGN = { kind: 'action', group: 'design', showRomAck: true } as const;
const ROM = { low: '900000.0000', high: '1200000.0000', issuedAt: '2026-09-01T09:00:00.123456+00:00' };
const DASH = /[–—]/;
const ARABIC_INDIC = /[٠-٩۰-۹]/;

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  router.refresh.mockReset();
});

async function approveWithBudget(locale: TestLocale, outcome: DesignWithBudgetOutcome): Promise<string> {
  actions.approveDesignWithBudget.mockResolvedValue(outcome);
  const { container } = renderCommandCard(
    { hero: DESIGN, clientActions: ['approve_design', 'request_design_changes', 'acknowledge_rom'], stageKey: 'finalApproval', rom: ROM },
    { locale },
  );
  fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.hero.design.approve') }));
  await answerDialog(locale, 'confirm');
  await act(async () => {});
  expect(actions.approveDesignWithBudget).toHaveBeenCalledTimes(1);
  return container.textContent ?? '';
}

const LOCALES: TestLocale[] = ['en', 'ar-EG'];

describe('the budget half of approve+budget (S10)', () => {
  it.each(LOCALES)('%s: approved + changed asks to review the new range, and the page re-reads', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'approved', studioNotified: true, budget: 'changed' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.approvedTitle'));
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetReviewAgain'));
    expect(text).not.toContain(messageAt(locale, 'delivery.hero.design.budgetAcknowledged'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(DASH.test(text) || ARABIC_INDIC.test(text)).toBe(false);
  });

  it.each(LOCALES)('%s: approved + failed says the budget was not saved', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'approved', studioNotified: false, budget: 'failed' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetNotSaved'));
    expect(DASH.test(text) || ARABIC_INDIC.test(text)).toBe(false);
  });

  it.each(LOCALES)('%s: approved + acknowledged confirms both', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetAcknowledged'));
    expect(text).not.toContain(messageAt(locale, 'delivery.hero.design.budgetReviewAgain'));
  });

  it.each(LOCALES)('%s: changed + acknowledged says the design changed and the budget was recorded', async (locale) => {
    await approveWithBudget(locale, { kind: 'changed', budget: 'acknowledged' });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain(messageAt(locale, 'delivery.actions.changed'));
    expect(alert).toContain(messageAt(locale, 'delivery.hero.design.budgetAcknowledgedOnly'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(DASH.test(alert) || ARABIC_INDIC.test(alert)).toBe(false);
  });

  it.each(LOCALES)('%s: both changed says only that the step changed', async (locale) => {
    await approveWithBudget(locale, { kind: 'changed', budget: 'changed' });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.actions.changed'));
  });
});
