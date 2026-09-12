import { describe, expect, it } from 'vitest';
import { normalizeSignedMoney } from './validation';

describe('normalizeSignedMoney', () => {
  it('clamps to the numeric(18,4) scale, sign-symmetrically', () => {
    // The bug: unclamped, a de-scope was computed at -1.23456 and stored as
    // -1.2346 (Postgres rounds), so the VO total moved across a save.
    expect(normalizeSignedMoney('-1.23456')).toBe('-1.2345');
    expect(normalizeSignedMoney('1.23456')).toBe('1.2345');
  });

  it('treats absent and empty as zero', () => {
    expect(normalizeSignedMoney('')).toBe('0');
    expect(normalizeSignedMoney(undefined)).toBe('0');
  });

  it('rejects comma-decimal corruption and non-numeric text', () => {
    // '1,5' must NOT become 15 (§ money parser).
    expect(normalizeSignedMoney('1,5')).toBeNull();
    expect(normalizeSignedMoney('abc')).toBeNull();
  });

  it('keeps a negative de-scope that already fits the scale unchanged', () => {
    expect(normalizeSignedMoney('-5')).toBe('-5');
  });
});
