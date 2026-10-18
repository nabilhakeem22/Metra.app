import { describe, expect, it } from 'vitest';
import { searchForm } from './fold';
import { cleanSearchQuery } from './query-input';

describe('search folding', () => {
  it('folds what studios type interchangeably', () => {
    const variants = ['مواسير بولى بروبلين', 'مواسير بولي  بروبلين', 'مواسير بولی بروبلين', 'مواسيـر بولي بروبلين', 'مَواسير بولي بروبلين'];
    expect(new Set(variants.map(searchForm)).size).toBe(1);
    expect(searchForm('Gypsum' + String.fromCharCode(0xa0) + 'BOARD')).toBe('gypsum board');
    expect(searchForm('أإآ ة')).toBe('ااا ه');
  });

  it('folds the Arabic-Indic digits an Arabic keyboard types into Latin ones (P1)', () => {
    expect(searchForm('نحاس ٢ مم')).toBe('نحاس 2 مم');
    expect(searchForm('نحاس ۲ مم')).toBe('نحاس 2 مم');
    expect(searchForm('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(searchForm('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('folds the Arabic decimal mark into a point, and drops tatweel and tashkeel', () => {
    expect(searchForm('بند ٣٫٧')).toBe('بند 3.7');
    expect(searchForm('دهـان')).toBe('دهان');
  });

  it('drops U+0000 from a typed search before cutting it (S2)', () => {
    const nul = String.fromCharCode(0);
    expect(cleanSearchQuery(`a${nul}b`, 100)).toBe('ab');
    expect(cleanSearchQuery(`${nul.repeat(5)}abc`, 2)).toBe('ab');
  });
});
