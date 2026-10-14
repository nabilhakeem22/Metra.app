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

/** Every budget line talks about the budget ONLY: no clause about the design (D3 F1). */
const BUDGET_LINES = ['budgetAcknowledged', 'budgetReviewAgain', 'budgetNotSaved', 'budgetAcknowledgedOnly'] as const;
const DESIGN_CLAIM = { en: /approv|design/i, 'ar-EG': /اعتماد|التصميم/ } as const;

describe('the budget half of approve+budget (S10)', () => {
  it.each(LOCALES)('%s: no budget line says anything about the design', (locale) => {
    for (const key of BUDGET_LINES) {
      expect(messageAt(locale, `delivery.hero.design.${key}`), key).not.toMatch(DESIGN_CLAIM[locale]);
    }
  });

  it.each(LOCALES)('%s: approved + changed: the approval card, and the budget line asks for the current range', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'approved', studioNotified: true, budget: 'changed' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.approvedTitle'));
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetReviewAgain'));
    expect(text).not.toContain(messageAt(locale, 'delivery.hero.design.budgetAcknowledged'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(DASH.test(text) || ARABIC_INDIC.test(text)).toBe(false);
  });

  it.each(LOCALES)('%s: F1: changes requested + changed never says an approval is on file', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'changes_requested', studioNotified: true, budget: 'changed' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.changesTitle'));
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetReviewAgain'));
    expect(text).not.toContain(messageAt(locale, 'delivery.hero.design.approvedTitle'));
  });

  it.each(LOCALES)('%s: approved + failed says the budget was not saved, and points at no card', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'approved', studioNotified: false, budget: 'failed' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetNotSaved'));
    expect(messageAt(locale, 'delivery.hero.design.budgetNotSaved')).not.toMatch(/card|below|بطاقة|أدناه/);
    expect(DASH.test(text) || ARABIC_INDIC.test(text)).toBe(false);
  });

  it.each(LOCALES)('%s: approved + acknowledged confirms both', async (locale) => {
    const text = await approveWithBudget(locale, { kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect(text).toContain(messageAt(locale, 'delivery.hero.design.budgetAcknowledged'));
    expect(text).not.toContain(messageAt(locale, 'delivery.hero.design.budgetReviewAgain'));
  });

  it.each(LOCALES)('%s: F4: changed + acknowledged is ONE sentence: approval not sent, budget recorded', async (locale) => {
    await approveWithBudget(locale, { kind: 'changed', budget: 'acknowledged' });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toBe(messageAt(locale, 'delivery.hero.design.approvalNotSentBudgetSaved'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(DASH.test(alert) || ARABIC_INDIC.test(alert)).toBe(false);
  });

  it.each(LOCALES)('%s: R4: a design failure after a saved budget is a try-again error, the budget line, and a refresh', async (locale) => {
    await approveWithBudget(locale, { kind: 'error', error: 'generic', budget: 'acknowledged' });
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain(messageAt(locale, 'portal.errors.generic'));
    expect(alert).toContain(messageAt(locale, 'delivery.hero.design.budgetAcknowledgedOnly'));
    expect(alert).not.toContain(messageAt(locale, 'delivery.actions.changed'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(LOCALES)('%s: both changed says only that the step changed', async (locale) => {
    await approveWithBudget(locale, { kind: 'changed', budget: 'changed' });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.actions.changed'));
  });
});
