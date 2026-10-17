import { COST_ITEM_UNITS } from '@metra/db';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import ar from '@/messages/ar-EG.json';
import { normalizeUnit } from '@/lib/boqs/import/map';
import { resolveUnit } from './import';

// Every cost-item unit must be labelled wherever a unit is shown and accepted
// wherever one is imported. `cost_item_unit` grew five values with the market
// price book (0061); a unit missing from a catalog throws MISSING_MESSAGE at
// render, and one missing from an alias map makes its own key unimportable.
const catalogs = { en, 'ar-EG': ar } as const;

describe.each(Object.entries(catalogs))('the %s catalog', (_locale, catalog) => {
  it.each([...COST_ITEM_UNITS])('labels %s in the price book and the BOQ sheet', (unit) => {
    expect(catalog.priceBook.units[unit].trim()).not.toBe('');
    expect(catalog.projects.profile.boq.unit[unit].trim()).not.toBe('');
  });
});

describe('the import alias maps', () => {
  it.each([...COST_ITEM_UNITS])('resolve their own key %s', (unit) => {
    expect(resolveUnit(unit)).toBe(unit);
    expect(normalizeUnit(unit)).toBe(unit);
  });

  it.each([
    ['كجم', 'kg'],
    ['طن', 'ton'],
    ['لتر', 'liter'],
    ['م3', 'cbm'],
    ['لفة', 'roll'],
  ])('read the Arabic %s as %s', (label, unit) => {
    expect(resolveUnit(label)).toBe(unit);
    expect(normalizeUnit(label)).toBe(unit);
  });
});
