import { describe, expect, it } from 'vitest';
import { byName, nameIn } from './name-order';

describe('name-order', () => {
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
