import { describe, expect, it } from 'vitest';
import { normalizeDecimalInput } from './decimal-input';

describe('normalizeDecimalInput', () => {
  it.each([
    ['١٢', '12'],
    ['۱۲۳', '123'],
    ['١٢٫٥', '12.5'],
    ['1,000', '1000'],
    ['12,500.5', '12500.5'],
    ['١٬٠٠٠', '1000'],
    ['1.', '1'],
    [' 7 ', '7'],
    ['0.25', '0.25'],
  ])('%s reads as %s', (raw, expected) => {
    expect(normalizeDecimalInput(raw)).toBe(expected);
  });

  it.each(['1,5', '1,00', 'abc', '-3', '1.2.3', ''])('%s is left for the parser to refuse', (raw) => {
    expect(normalizeDecimalInput(raw)).toBe(raw.trim());
  });
});
