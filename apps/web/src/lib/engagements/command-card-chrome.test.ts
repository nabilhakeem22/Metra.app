import { describe, expect, test } from 'vitest';
import { resolveCommandCardChrome } from './command-card-chrome';
import type { DeliveryStatus } from './delivery-status';

const BRAND = { stripeClass: 'bg-brand', borderClass: 'border-[color:var(--brand-tint-border)]' };
const NEUTRAL = { stripeClass: 'bg-[color:var(--rule)]', borderClass: 'border-[color:var(--rule)]' };
const WARN = { stripeClass: 'bg-[color:var(--warn)]', borderClass: 'border-[color:var(--warn-tint)]' };
const SUCCESS = {
  stripeClass: 'bg-[color:var(--success)]',
  borderClass: 'border-[color:var(--success-tint)]',
};

describe('resolveCommandCardChrome: one colour family per delivery status', () => {
  const table: [DeliveryStatus, typeof BRAND][] = [
    [{ kind: 'yourMove' }, BRAND],
    [{ kind: 'confirmPayment' }, BRAND],
    [{ kind: 'waitingClient', days: 3 }, NEUTRAL],
    [{ kind: 'stalled', days: 9 }, WARN],
    [{ kind: 'delivered' }, SUCCESS],
    [{ kind: 'abandoned' }, NEUTRAL],
  ];

  test.each(table)('%o', (status, expected) => {
    expect(resolveCommandCardChrome(status)).toEqual(expected);
  });

  test('your move and waiting on the client never share a colour', () => {
    expect(resolveCommandCardChrome({ kind: 'yourMove' })).not.toEqual(
      resolveCommandCardChrome({ kind: 'waitingClient', days: 0 }),
    );
  });

  // Logical CSS only (metra/no-physical-inline-direction): nothing here may name
  // left or right, because this card mirrors wholesale in ar-EG.
  test('no class names a physical direction or the danger colour', () => {
    for (const [status] of table) {
      const { stripeClass, borderClass } = resolveCommandCardChrome(status);
      expect(`${stripeClass} ${borderClass}`).not.toMatch(/\b(left|right)\b|danger|destructive/);
    }
  });
});
