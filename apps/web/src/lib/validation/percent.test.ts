import { describe, expect, it } from 'vitest';
import { isPercentInRange, normalizePercent } from './percent';

// These assertions were split out of ./text.test.ts (normalizePercent) and
// lib/proposals/validation.test.ts (the former `pctInRange`, which was a second
// hand-written predicate over the same [0,100] rule). Both now describe ONE
// implementation, and the equivalence table below is what keeps them one.

describe('normalizePercent', () => {
  it('returns the blank value for absent input, defaulting to zero', () => {
    for (const value of [null, undefined, '', '  ']) {
      expect(normalizePercent(value)).toBe('0');
      expect(normalizePercent(value, '12')).toBe('12'); // caller-chosen blank
    }
  });

  it('accepts the decimal percentage strings the forms actually submit', () => {
    expect(normalizePercent('0')).toBe('0');
    expect(normalizePercent('10')).toBe('10');
    expect(normalizePercent('12.5')).toBe('12.5');
    expect(normalizePercent('100')).toBe('100');
    expect(normalizePercent('  7.25  ')).toBe('7.25'); // trimmed, then shape-checked
  });

  it('refuses what Number() would have silently accepted', () => {
    // Every one of these coerces to a finite number in [0,100] under Number(), so
    // a range check alone would let them through to a numeric column.
    expect(Number('1e2')).toBe(100);
    expect(Number('0x1A')).toBe(26);
    expect(Number('')).toBe(0);
    for (const value of ['1e2', '0x1A', '+5', '5%', '1,5', '.5', '5.', 'NaN', 'Infinity']) {
      expect(normalizePercent(value)).toBeNull();
    }
  });

  it('refuses negatives and anything past 100', () => {
    for (const value of ['-1', '100.0001', '101', '1000']) {
      expect(normalizePercent(value)).toBeNull();
    }
  });

  it('lets a caller ask for null on absent input rather than a zero', () => {
    // The mode isPercentInRange runs in: a cleared field is not 0%.
    expect(normalizePercent('', null)).toBeNull();
    expect(normalizePercent(null, null)).toBeNull();
  });
});

describe('isPercentInRange', () => {
  it('accepts 0 through 100 inclusive', () => {
    for (const value of ['0', '0.5', '17.25', '99.9999', '100']) {
      expect(isPercentInRange(value)).toBe(true);
    }
  });

  it('rejects out-of-range and negative', () => {
    for (const value of ['100.0001', '101', '-1', '-0.5']) {
      expect(isPercentInRange(value)).toBe(false);
    }
  });

  it('rejects the shapes bare Number() coerced into a valid percentage', () => {
    // '0x10' read as 16%, '1e2' as 100%, and '' as 0% — a silent discount.
    for (const junk of ['0x10', '1e2', '0b11', '', '   ', 'abc', 'Infinity']) {
      expect(isPercentInRange(junk)).toBe(false);
    }
  });

  it('is the predicate form of normalizePercent, for every shape that mattered', () => {
    // The two used to be separate implementations in separate modules — this
    // table is what proves the merge changed no verdict, and it fails the moment
    // one of them grows a rule the other does not have.
    for (const value of [
      '0',
      '100',
      '100.0001',
      '-1',
      '1e2',
      '0x1A',
      ' 5 ',
      '',
      '5.5',
      'abc',
    ]) {
      expect(isPercentInRange(value)).toBe(normalizePercent(value, null) !== null);
    }
  });
});
