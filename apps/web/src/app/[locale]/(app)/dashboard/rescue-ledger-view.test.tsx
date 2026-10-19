import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { shapeRescueLedger } from '@/lib/dashboard/rescue-ledger/shape';
import type { RescueLedger } from '@/lib/dashboard/rescue-ledger/types';
import { formatMoney } from '@/lib/format/money';
import { messageAt, renderWithIntl, TEST_NOW, type TestLocale } from '@/test/render-with-intl';
import { RescueLedgerView } from './rescue-ledger-view';

// The rendered ledger in both locales, from fixtures: Latin digits only, money
// through formatMoney set left to right, and no estimated figure anywhere.

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
const LOCALES: TestLocale[] = ['ar-EG', 'en'];

const FILLED: RescueLedger = shapeRescueLedger(
  [
    { risk: 'r4', month: null, events: 3, deliveries: 2, amount: '1234567.5000', followups: null },
    { risk: 'r4', month: '2026-05', events: 3, deliveries: 2, amount: '1234567.5000', followups: null },
    { risk: 'r3', month: null, events: 1, deliveries: 1, amount: '2000.0000', followups: null },
    { risk: 'r3', month: '2026-06', events: 1, deliveries: 1, amount: '2000.0000', followups: null },
    { risk: 'collected', month: null, events: 4, deliveries: 2, amount: '1236567.5000', followups: null },
    { risk: 'collected', month: '2026-05', events: 3, deliveries: 2, amount: '1234567.5000', followups: null },
    { risk: 'collected', month: '2026-06', events: 1, deliveries: 1, amount: '2000.0000', followups: null },
    { risk: 'r2', month: null, events: 5, deliveries: 4, amount: null, followups: 9 },
    { risk: 'r2', month: '2026-06', events: 5, deliveries: 4, amount: null, followups: 9 },
  ],
  6,
  TEST_NOW,
);

const EMPTY: RescueLedger = shapeRescueLedger([], 6, TEST_NOW);

const render = (ledger: RescueLedger, locale: TestLocale) =>
  renderWithIntl(<RescueLedgerView ledger={ledger} locale={locale} />, { locale });

describe('RescueLedgerView', () => {
  test.each(LOCALES)('%s: renders zero Arabic-Indic digits, hover read-outs included', (locale) => {
    const { container } = render(FILLED, locale);
    expect(container.textContent).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(container.innerHTML).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  test.each(LOCALES)('%s: each money figure is the formatMoney string, set left to right', (locale) => {
    render(FILLED, locale);
    for (const amount of ['1236567.5000', '1234567.5000', '2000.0000']) {
      const figure = screen.getAllByText(formatMoney(amount, locale))[0];
      expect(figure.closest('[dir="ltr"]')).toBeTruthy();
    }
  });

  test.each(LOCALES)('%s: the protected card shows only its locked line, and no figure', (locale) => {
    render(FILLED, locale);
    const title = screen.getByText(messageAt(locale, 'dashboard.rescue.cards.protectedTitle'));
    const card = title.parentElement!;
    expect(card.textContent).toBe(
      messageAt(locale, 'dashboard.rescue.cards.protectedTitle') + messageAt(locale, 'dashboard.rescue.cards.protectedLocked'),
    );
    expect(card.textContent).not.toMatch(/[0-9]/);
  });

  // F5: real plural forms, with Latin digits. These assert rendered WORDS on
  // purpose: choosing the plural form is the behaviour under test.
  test('en: the cards carry their inputs in the right plural, and every figure its source', () => {
    render(FILLED, 'en');
    expect(screen.getByText('3 payments on 2 deliveries')).toBeTruthy();
    expect(screen.getByText('1 payment on 1 delivery')).toBeTruthy();
    expect(screen.getByText(/^Metra flagged 9 waits,/)).toBeTruthy();
    expect(screen.getByText(/in the last 6 months,/)).toBeTruthy();
    // Four figure cards and both charts.
    expect(screen.getAllByText(messageAt('en', 'dashboard.rescue.basedOnYourData'))).toHaveLength(6);
  });

  test('ar-EG: the Arabic plural forms, never Arabic-Indic digits', () => {
    render(FILLED, 'ar-EG');
    expect(screen.getByText('3 دفعات على تسليمين')).toBeTruthy();
    expect(screen.getByText('دفعة واحدة على تسليم واحد')).toBeTruthy();
    expect(screen.getByText(/^ميترا نبهتك 9 مرات،/)).toBeTruthy();
    expect(screen.getByText(/في آخر 6 شهور،/)).toBeTruthy();
  });

  test.each(LOCALES)('%s: an empty ledger shows zeros and the empty line in both charts, no error', (locale) => {
    render(EMPTY, locale);
    expect(screen.getAllByText(messageAt(locale, 'dashboard.rescue.empty'))).toHaveLength(2);
    expect(screen.getAllByText(formatMoney('0.0000', locale))).toHaveLength(3);
    // The zero state claims no action and no outcome.
    expect(screen.getAllByText(messageAt(locale, 'dashboard.rescue.cards.moneyNone'))).toHaveLength(3);
    expect(screen.getByText(messageAt(locale, 'dashboard.rescue.cards.stagesMovedNone'))).toBeTruthy();
    expect(screen.queryByText(/\d payments? on|Metra flagged|دفعة على|ولا دفعة|ميترا نبهتك/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
