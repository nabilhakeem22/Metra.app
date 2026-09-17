import { describe, expect, test } from 'vitest';
import type { CommandCardMode } from './command-card';
import {
  derivePillKey,
  resolveCommandCardChrome,
  type CommandCardPillKey,
} from './command-card-chrome';

const MODES: CommandCardMode[] = ['closed', 'ready', 'blockedStudio', 'blockedClient'];

describe('derivePillKey — the pill table, 4 modes x claim-count 0 and 2', () => {
  const table: [CommandCardMode, number, CommandCardPillKey][] = [
    ['closed', 0, 'closed'],
    ['closed', 2, 'closed'],
    ['ready', 0, 'ready'],
    ['ready', 2, 'ready'],
    ['blockedStudio', 0, 'studio'],
    ['blockedStudio', 2, 'studio'],
    ['blockedClient', 0, 'waitingClient'],
    // THE ONE ROW THAT MATTERS: a claim actually sits with the STUDIO, so the
    // card must not read "waiting on the client".
    ['blockedClient', 2, 'paymentToConfirm'],
  ];

  test.each(table)('%s + %i claims -> %s', (mode, claims, expected) => {
    expect(derivePillKey(mode, claims)).toBe(expected);
  });

  test('only blockedClient is sensitive to the claim count', () => {
    for (const mode of MODES) {
      if (mode === 'blockedClient') continue;
      expect(derivePillKey(mode, 0)).toBe(derivePillKey(mode, 5));
    }
  });
});

describe('resolveCommandCardChrome — the four class families', () => {
  const chromeFor = (mode: CommandCardMode, paymentClaimCount = 0) =>
    resolveCommandCardChrome({ mode, paymentClaimCount });

  test('closed is NEUTRAL', () => {
    const chrome = chromeFor('closed');
    expect(chrome.accent).toBe('neutral');
    expect(chrome.stripeClass).toBe('bg-[color:var(--rule)]');
    expect(chrome.borderClass).toBe('border-[color:var(--rule)]');
  });

  test('ready is BRAND', () => {
    const chrome = chromeFor('ready');
    expect(chrome.accent).toBe('brand');
    expect(chrome.stripeClass).toBe('bg-brand');
    expect(chrome.pillClass).toBe('bg-brand-tint text-brand-ink');
  });

  test('both blocked modes are WARN — attention, not failure', () => {
    for (const mode of ['blockedStudio', 'blockedClient'] as const) {
      expect(chromeFor(mode).accent).toBe('warn');
      expect(chromeFor(mode).stripeClass).toBe('bg-[color:var(--warn)]');
    }
  });

  test('every mode gets all four class families, none empty', () => {
    for (const mode of MODES) {
      const chrome = chromeFor(mode);
      expect(chrome.stripeClass).not.toBe('');
      expect(chrome.pillClass).not.toBe('');
      expect(chrome.borderClass).not.toBe('');
    }
  });

  // Logical CSS only (metra/no-physical-inline-direction): nothing here may name
  // left or right, because this card mirrors wholesale in ar-EG.
  test('no class family names a physical direction', () => {
    for (const mode of MODES) {
      const chrome = chromeFor(mode);
      const classes = `${chrome.stripeClass} ${chrome.pillClass} ${chrome.borderClass}`;
      expect(classes).not.toMatch(/\b(left|right)\b/);
    }
  });
});

describe('resolveCommandCardChrome — the pill and the waiting flag', () => {
  test('the pill renders ONLY for paymentToConfirm', () => {
    for (const mode of MODES) {
      const expected = mode === 'blockedClient';
      expect(resolveCommandCardChrome({ mode, paymentClaimCount: 2 }).showPaymentPill).toBe(
        expected,
      );
      expect(resolveCommandCardChrome({ mode, paymentClaimCount: 0 }).showPaymentPill).toBe(
        false,
      );
    }
  });

  test('waitingOnClient is exactly the blockedClient mode', () => {
    for (const mode of MODES) {
      expect(resolveCommandCardChrome({ mode, paymentClaimCount: 0 }).waitingOnClient).toBe(
        mode === 'blockedClient',
      );
    }
  });
});
