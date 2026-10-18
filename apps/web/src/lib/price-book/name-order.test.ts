import { describe, expect, it } from 'vitest';
import { byName, nameIn, searchForm } from './name-order';

describe('name-order', () => {
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

  it('reads the name in the page language, the other one when empty', () => {
    expect(nameIn({ nameAr: 'دولاب', nameEn: 'Wardrobe' }, 'ar-EG')).toBe('دولاب');
    expect(nameIn({ nameAr: '  ', nameEn: 'Wardrobe' }, 'ar-EG')).toBe('Wardrobe');
    expect(nameIn({ nameAr: 'دولاب', nameEn: null }, 'en')).toBe('دولاب');
  });

  it('orders numbers inside names naturally', () => {
    const rows = [{ nameAr: null, nameEn: 'Pipe 10 mm' }, { nameAr: null, nameEn: 'Pipe 2 mm' }];
    expect(rows.sort(byName('en')).map((row) => row.nameEn)).toEqual(['Pipe 2 mm', 'Pipe 10 mm']);
  });
});
