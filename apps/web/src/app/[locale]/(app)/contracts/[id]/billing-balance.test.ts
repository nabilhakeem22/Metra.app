import { describe, expect, it } from 'vitest';
import { balanceFit, leftToBillShown } from './billing-balance';

// A4 F11: "left to bill" is never said below zero, and a contract already
// fully billed is said as that, not as a negative figure.

describe('leftToBillShown', () => {
  it('is the balance while something is left, and zero once nothing is', () => {
    expect(leftToBillShown('31248.0000')).toBe('31248.0000');
    expect(leftToBillShown('0.0000')).toBe('0.0000');
    expect(leftToBillShown('-30752.0000')).toBe('0.0000');
  });
});

describe('balanceFit', () => {
  it('is within, over, or covered', () => {
    expect(balanceFit('100.0000', '100.0000')).toBe('within');
    expect(balanceFit('100.0001', '100.0000')).toBe('over');
    expect(balanceFit('100.0000', '0.0000')).toBe('covered');
    expect(balanceFit('100.0000', '-30752.0000')).toBe('covered');
  });
});
