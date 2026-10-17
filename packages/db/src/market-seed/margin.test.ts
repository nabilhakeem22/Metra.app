import { describe, expect, it } from 'vitest';
import { atPriceBookScale, withFivePercentMargin } from './margin';

describe('the seeded selling price', () => {
  it.each([
    ['38200', '40110.0000'],
    ['30.455', '31.9778'],
    ['11.1', '11.6550'],
    ['10.374', '10.8927'],
    ['0.0001', '0.0001'],
    ['0.0010', '0.0011'],
    ['2050', '2152.5000'],
  ])('is %s x 1.05 = %s, half up at 4 decimals', (cost, price) => {
    expect(withFivePercentMargin(cost)).toBe(price);
  });

  it('carries the cost at the price-book scale', () => {
    expect(atPriceBookScale('30.455')).toBe('30.4550');
    expect(atPriceBookScale('38200')).toBe('38200.0000');
  });
});
