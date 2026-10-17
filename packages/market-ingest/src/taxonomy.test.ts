import { describe, expect, it } from 'vitest';
import { LEAF_CATEGORIES, TOP_CATEGORIES, categoriesFor, isLeafCategory } from './taxonomy';

describe('taxonomy', () => {
  it('keeps the owner display order of the 8 tops (D8)', () => {
    expect(TOP_CATEGORIES.map((top) => top.key)).toEqual([
      'finishing', 'cladding', 'paints', 'electrical', 'pipes', 'insulation', 'raw', 'roads',
    ]);
  });

  it('gives every category a key the database CHECK accepts and both names', () => {
    for (const category of [...TOP_CATEGORIES, ...LEAF_CATEGORIES]) {
      expect(category.key).toMatch(/^[a-z_]+(\.[a-z_]+)?$/);
      expect(category.nameAr.trim()).not.toBe('');
      expect(category.nameEn.trim()).not.toBe('');
      expect(category.nameAr).not.toMatch(/[\u2013\u2014\u0660-\u0669]/);
    }
    expect(new Set(LEAF_CATEGORIES.map((leaf) => leaf.key)).size).toBe(LEAF_CATEGORIES.length);
  });

  it('knows leaves and refuses tops and strangers', () => {
    expect(isLeafCategory('finishing.glass')).toBe(true);
    expect(isLeafCategory('finishing')).toBe(false);
    expect(isLeafCategory('finishing.mirrors')).toBe(false);
  });

  it('lists the tops a set of leaves needs, tops first', () => {
    expect(categoriesFor(['raw.cement', 'finishing.glass']).map((category) => category.key)).toEqual([
      'finishing', 'raw', 'finishing.glass', 'raw.cement',
    ]);
  });
});
