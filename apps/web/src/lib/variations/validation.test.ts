import { describe, expect, it } from 'vitest';
import { readMoneyString } from '@/lib/money/read';
import { SIGNED_MONEY_FIELD } from './validation';

// The EXACT option set variations/core/update.ts uses for a VO quantity.
const readSignedAmount = (value: string | null | undefined) =>
  readMoneyString(value, SIGNED_MONEY_FIELD);

describe('a variation-order amount', () => {
  it('clamps to the numeric(18,4) scale, sign-symmetrically', () => {
    // The bug: unclamped, a de-scope was computed at -1.23456 and stored as
    // -1.2346 (Postgres rounds), so the VO total moved across a save.
    expect(readSignedAmount('-1.23456')).toBe('-1.2345');
    expect(readSignedAmount('1.23456')).toBe('1.2345');
  });

  it('treats absent and empty as zero', () => {
    expect(readSignedAmount('')).toBe('0');
    expect(readSignedAmount(undefined)).toBe('0');
  });

  it('rejects comma-decimal corruption and non-numeric text', () => {
    // '1,5' must NOT become 15 (§ money parser).
    expect(readSignedAmount('1,5')).toBeNull();
    expect(readSignedAmount('abc')).toBeNull();
  });

  it('keeps a negative de-scope that already fits the scale unchanged', () => {
    expect(readSignedAmount('-5')).toBe('-5');
  });
});
