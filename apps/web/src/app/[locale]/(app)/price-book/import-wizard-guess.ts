// The import wizard's first guess at which spreadsheet column is which field,
// by header text in English or Arabic. Pure.
import type { ColumnMapping } from '@/lib/price-book/import';
import type { FieldKey } from './import-wizard-fields';

const GUESS: Record<FieldKey, string[]> = {
  code: ['code', 'كود', 'الكود'],
  nameEn: ['name (en', 'english', 'name_en', 'nameen', 'name'],
  nameAr: ['name (ar', 'arabic', 'name_ar', 'namear', 'الاسم'],
  category: ['category', 'الفئة', 'فئة'],
  unit: ['unit', 'الوحدة', 'وحدة'],
  cost: ['cost', 'التكلفة', 'تكلفة'],
  price: ['price', 'السعر', 'سعر'],
  taxCode: ['tax', 'ضريبة'],
  etaItemCode: ['eta item', 'eta_item'],
  etaCodeType: ['eta type', 'eta_code'],
};

export function guessMapping(header: string[]): ColumnMapping {
  const find = (aliases: string[]): number => {
    const idx = header.findIndex((h) => {
      const n = h.trim().toLowerCase();
      return aliases.some((a) => n.includes(a));
    });
    return idx;
  };
  return {
    code: find(GUESS.code),
    nameEn: find(GUESS.nameEn),
    nameAr: find(GUESS.nameAr),
    category: find(GUESS.category),
    unit: find(GUESS.unit),
    cost: find(GUESS.cost),
    price: find(GUESS.price),
  };
}
