import { describe, expect, it } from 'vitest';
import { compactFigure } from './figure-display';

describe('compactFigure: a stored figure without its trailing zeros', () => {
  it.each([
    ['13200.0000', '13200'],
    ['0.0000', '0'],
    ['14.0000', '14'],
    ['12.5000', '12.5'],
    ['0.1250', '0.125'],
    ['1250000.0500', '1250000.05'],
    ['100', '100'],
    ['10.0001', '10.0001'],
  ])('%s shows as %s', (stored, shown) => {
    expect(compactFigure(stored)).toBe(shown);
    // Display only: never a different number.
    expect(Number(compactFigure(stored))).toBe(Number(stored));
  });

  it.each(['1,5', '', 'abc', '7.', '1,000.00', '١٢٫٥٠'])('leaves %j as it is', (typed) => {
    expect(compactFigure(typed)).toBe(typed);
  });

  it('keeps zeros inside the integer part', () => {
    expect(compactFigure('100.0000')).toBe('100');
    expect(compactFigure('1000.0')).toBe('1000');
  });
});
