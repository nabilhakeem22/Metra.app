import { MARKET_UNITS } from '@metra/db';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import ar from '@/messages/ar-EG.json';
import { studioUnitFor, unitsCompatible } from './units';

describe('market units against studio units', () => {
  it.each([
    ['ton', 'ton'],
    ['kg', 'kg'],
    ['sqm', 'sqm'],
    ['cbm', 'cbm'],
    ['linear_meter', 'linear_meter'],
    ['liter', 'liter'],
    ['pcs', 'pcs'],
    ['roll', 'roll'],
  ] as const)('adds a %s item as %s', (marketUnit, costUnit) => {
    expect(studioUnitFor(marketUnit)).toBe(costUnit);
    expect(unitsCompatible(costUnit, marketUnit)).toBe(true);
  });

  it.each(['bag', 'pack', 'thousand_bricks'] as const)('refuses to add a %s item (no closest-unit guess)', (marketUnit) => {
    expect(studioUnitFor(marketUnit)).toBeNull();
    expect(unitsCompatible('pcs', marketUnit)).toBe(false);
  });

  it('never compares across units', () => {
    expect(unitsCompatible('pcs', 'sqm')).toBe(false);
    expect(unitsCompatible('lump_sum', 'pcs')).toBe(false);
    expect(unitsCompatible('day', 'roll')).toBe(false);
  });

  it.each([['en', en], ['ar-EG', ar]] as const)('labels every market unit in the %s catalog, and the refusal', (_locale, catalog) => {
    for (const unit of MARKET_UNITS) expect(catalog.marketBook.units[unit].trim()).not.toBe('');
    expect(catalog.marketBook.unitNotSupported.trim()).not.toBe('');
  });
});
