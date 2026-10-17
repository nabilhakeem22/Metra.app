import { describe, expect, it } from 'vitest';
import { marketUnitOf } from './units';

describe('marketUnitOf', () => {
  it.each([
    ['طن', 'ton'],
    ['كجم', 'kg'],
    ['م2', 'sqm'],
    ['م٢', 'sqm'],
    ['متر مربع', 'sqm'],
    ['م3', 'cbm'],
    ['متر طولي', 'linear_meter'],
    ['م.ط', 'linear_meter'],
    ['لتر', 'liter'],
    ['عدد', 'pcs'],
    ['اللوح', 'pcs'],
    ['عود', 'pcs'],
    ['شيكارة', 'bag'],
    ['اللفة (100 م.ط)', 'roll_100m'],
    ['اللفة (١٠٠م.ط)', 'roll_100m'],
    ['اللفه ( 100 م.ط )', 'roll_100m'],
  ])('maps %s to %s', (label, unit) => {
    expect(marketUnitOf(label)).toBe(unit);
  });

  it('refuses a label the map does not know', () => {
    expect(marketUnitOf('برميل')).toBeNull();
    expect(marketUnitOf('اللفة')).toBeNull();
  });
});
