// The cost-item form's typed state and its two conversions: from a saved item,
// and to the action input. Plain functions, so they are tested without a sheet.
import type { CostItemInput } from '@/lib/price-book/fields';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import type { PriceBookItem, SectionOption } from './types';

export interface CostItemFormState {
  code: string;
  nameEn: string;
  nameAr: string;
  sectionId: string;
  unit: string;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  taxCode: string;
  etaItemCode: string;
  etaCodeType: string;
}

export function emptyCostItemForm(sections: SectionOption[]): CostItemFormState {
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    sectionId: sections[0]?.id ?? '',
    unit: UNIT_TOKENS[0],
    defaultUnitCost: '0',
    defaultUnitPrice: '0',
    taxCode: '',
    etaItemCode: '',
    etaCodeType: '',
  };
}

export function costItemFormOf(item: PriceBookItem): CostItemFormState {
  return {
    code: item.code,
    nameEn: item.nameEn ?? '',
    nameAr: item.nameAr ?? '',
    sectionId: item.sectionId,
    unit: item.unit,
    defaultUnitCost: item.defaultUnitCost,
    defaultUnitPrice: item.defaultUnitPrice,
    taxCode: item.taxCode ?? '',
    etaItemCode: item.etaItemCode ?? '',
    etaCodeType: item.etaCodeType ?? '',
  };
}

export function costItemPayload(form: CostItemFormState): CostItemInput {
  return {
    code: form.code,
    nameEn: form.nameEn || null,
    nameAr: form.nameAr || null,
    sectionId: form.sectionId,
    unit: form.unit as PriceBookItem['unit'],
    defaultUnitCost: form.defaultUnitCost,
    defaultUnitPrice: form.defaultUnitPrice,
    taxCode: form.taxCode || null,
    etaItemCode: form.etaItemCode || null,
    etaCodeType: form.etaCodeType || null,
  };
}
