import { describe, expect, it } from 'vitest';
import { bilingualFor } from './bilingual';

describe('bilingualFor', () => {
  it('routes Arabic text to the Arabic column', () => {
    // Without this, an Arabic sheet imported into an Arabic-first product fills
    // description_en — which passes the bilingual CHECK and is still wrong.
    expect(bilingualFor('سقف جبسي معلق')).toEqual({
      descriptionAr: 'سقف جبسي معلق',
      descriptionEn: null,
    });
  });

  it('routes Latin text to the English column', () => {
    expect(bilingualFor('12mm gypsum ceiling')).toEqual({
      descriptionAr: null,
      descriptionEn: '12mm gypsum ceiling',
    });
  });

  it('treats a mixed string as Arabic', () => {
    // Right call for a BOQ, where the measurement is Latin and the noun is not.
    expect(bilingualFor('12mm سقف جبسي').descriptionAr).toBe('12mm سقف جبسي');
  });

  it('always fills exactly one side, so the bilingual CHECK holds', () => {
    for (const text of ['Walls', 'حوائط', '2.01 دهانات', 'x']) {
      const { descriptionAr, descriptionEn } = bilingualFor(text);
      expect([descriptionAr, descriptionEn].filter(Boolean)).toHaveLength(1);
    }
  });
});
