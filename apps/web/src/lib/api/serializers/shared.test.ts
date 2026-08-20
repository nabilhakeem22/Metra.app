import { describe, expect, it } from 'vitest';
import { toApiMoney, toApiQty, toIso } from './shared';

describe('toApiMoney — scale-4 string -> 2-decimal string (exact, no float)', () => {
  it('trims a whole-number scale-4 value', () => {
    expect(toApiMoney('1000.0000')).toBe('1000.00');
    expect(toApiMoney('14.0000')).toBe('14.00');
  });
  it('rounds the 3rd/4th decimals half away from zero', () => {
    expect(toApiMoney('14.1250')).toBe('14.13');
    expect(toApiMoney('14.1240')).toBe('14.12');
    expect(toApiMoney('0.0050')).toBe('0.01');
    expect(toApiMoney('0.0049')).toBe('0.00');
  });
  it('keeps full precision on large NUMERIC(18,4) values (no parseFloat drift)', () => {
    expect(toApiMoney('12345678901234.5600')).toBe('12345678901234.56');
    expect(toApiMoney('99999999999999.9950')).toBe('100000000000000.00');
  });
  it('handles negatives sign-symmetrically', () => {
    expect(toApiMoney('-14.1250')).toBe('-14.13');
    expect(toApiMoney('-0.0050')).toBe('-0.01');
  });
  it('does not emit "-0.00"', () => {
    expect(toApiMoney('-0.0000')).toBe('0.00');
    expect(toApiMoney('-0.0010')).toBe('0.00');
  });
  it('treats null/blank as 0.00', () => {
    expect(toApiMoney(null)).toBe('0.00');
    expect(toApiMoney(undefined)).toBe('0.00');
    expect(toApiMoney('')).toBe('0.00');
  });
});

describe('toApiQty — quantity string, trailing-zero noise trimmed', () => {
  it('trims a whole quantity', () => {
    expect(toApiQty('1.0000')).toBe('1');
    expect(toApiQty('10.0000')).toBe('10');
  });
  it('keeps up to two meaningful decimals', () => {
    expect(toApiQty('1.5000')).toBe('1.5');
    expect(toApiQty('2.2500')).toBe('2.25');
    expect(toApiQty('1.2000')).toBe('1.2');
  });
  it('rounds beyond two decimals and normalizes zero/blank', () => {
    expect(toApiQty('0.1250')).toBe('0.13');
    expect(toApiQty('0.0000')).toBe('0');
    expect(toApiQty(null)).toBe('0');
    expect(toApiQty('')).toBe('0');
  });
});

describe('toIso', () => {
  it('passes an ISO string through and stringifies a Date', () => {
    expect(toIso('2026-08-09T09:00:00.000Z')).toBe('2026-08-09T09:00:00.000Z');
    expect(toIso(new Date('2026-08-09T09:00:00Z'))).toBe(
      '2026-08-09T09:00:00.000Z',
    );
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
});
