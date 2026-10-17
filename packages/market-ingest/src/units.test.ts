import { MARKET_UNITS } from '@metra/db/schema';
import { describe, expect, it } from 'vitest';
import { describePack, samePack } from './roll-pack';
import { PRINTED_UNITS, marketUnitOf } from './units';

describe('marketUnitOf', () => {
  it.each([
    ['طن', 'ton'],
    ['كجم', 'kg'],
    ['م2', 'sqm'],
    ['م٢', 'sqm'],
    ['متر مربع', 'sqm'],
    ['متر مسطح', 'sqm'],
    ['م3', 'cbm'],
    ['متر طولي', 'linear_meter'],
    ['متر طولى', 'linear_meter'],
    ['م.ط', 'linear_meter'],
    ['م.طولي', 'linear_meter'],
    ['م.طولى', 'linear_meter'],
    ['لتر', 'liter'],
    ['عدد', 'pcs'],
    ['اللوح', 'pcs'],
    ['عود', 'pcs'],
    ['شيكارة', 'bag'],
    ['شيكاره', 'bag'],
    ['عبوة', 'pack'],
    ['الف طوبة', 'thousand_bricks'],
    ['ألف طوبة', 'thousand_bricks'],
  ])('maps %s to %s with no pack', (label, unit) => {
    expect(marketUnitOf(label)).toEqual({ unit, pack: null });
  });

  it.each([
    ['اللفة (100 م.ط)', 100],
    ['اللفة (١٠٠م.ط)', 100],
    ['اللفه ( 100 م.ط )', 100],
    ['اللفة (30 متر)', 30],
    ['اللفة 45 متر)', 45],
    ['اللفة 20 متر)', 20],
    ['اللفة (20 متر', 20],
    ['لفة 50 م', 50],
  ])('reads the roll %s as one length of %d m', (label, lengthM) => {
    expect(marketUnitOf(label)).toEqual({ unit: 'roll', pack: { lengthM, pieces: null, pieceLengthM: null } });
  });

  it.each([
    ['لفة عدد 34 ماسورة بطول 3 متر', 34, 3],
    ['لفة 34×3م', 34, 3],
    ['لفة 15×3متر', 15, 3],
    ['لفة 5×3متر', 5, 3],
    ['لفة 5 x 3 م', 5, 3],
    ['لفة 5*2.5م', 5, 2.5],
  ])('reads the roll %s as %d pieces of %d m', (label, pieces, pieceLengthM) => {
    expect(marketUnitOf(label)).toEqual({ unit: 'roll', pack: { lengthM: null, pieces, pieceLengthM } });
  });

  it('refuses a label the map does not know, and a roll with no readable size', () => {
    expect(marketUnitOf('برميل')).toBeNull();
    expect(marketUnitOf('اللفة')).toBeNull();
    expect(marketUnitOf('لفة كبيرة')).toBeNull();
  });

  it('reaches every market_unit value, and nothing else', () => {
    const reached = new Set([...PRINTED_UNITS.map(([, unit]) => unit), 'roll']);
    expect(reached).toEqual(new Set(MARKET_UNITS));
  });
});

describe('roll packs', () => {
  it('compares and describes packs', () => {
    const hundred = { lengthM: 100, pieces: null, pieceLengthM: null };
    expect(samePack(hundred, { ...hundred })).toBe(true);
    expect(samePack(hundred, { ...hundred, lengthM: 45 })).toBe(false);
    expect(samePack(null, null)).toBe(true);
    expect(samePack(hundred, null)).toBe(false);
    expect(describePack(hundred)).toBe('100 m');
    expect(describePack({ lengthM: null, pieces: 34, pieceLengthM: 3 })).toBe('34 x 3 m');
  });
});
