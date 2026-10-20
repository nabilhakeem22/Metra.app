// How a cost entry's targets read in the page's language. Pure: the row and
// the form both name a line, a section and a price book item the same way.
import type { CostEntryRow } from '@/lib/execution/costs/types';
import { pickLocale } from '@/lib/i18n/pick-locale';

const text = (ar: string | null, en: string | null, locale: string) => pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;

export function sectionLabel(entry: CostEntryRow, locale: string): string {
  return text(entry.sectionTitleAr, entry.sectionTitleEn, locale);
}

/** The line, then its section in brackets: how the line picker lists it. */
export function lineLabel(entry: CostEntryRow, locale: string): string {
  if (entry.contractLineId === null) return '';
  const description = text(entry.lineDescriptionAr, entry.lineDescriptionEn, locale) || entry.contractLineId.slice(0, 8);
  const section = sectionLabel(entry, locale);
  return section ? `${description} (${section})` : description;
}

/** Where the cost is booked: a line, a section, or `wholeContract`. */
export function targetLabel(entry: CostEntryRow, locale: string, wholeContract: string): string {
  if (entry.contractLineId !== null) return lineLabel(entry, locale);
  return entry.contractSectionId !== null ? sectionLabel(entry, locale) : wholeContract;
}

/** The price book item as its code and name. */
export function costItemLabel(entry: Pick<CostEntryRow, 'costItemCode' | 'costItemNameAr' | 'costItemNameEn'>, locale: string): string {
  if (entry.costItemCode === null) return '';
  const name = text(entry.costItemNameAr, entry.costItemNameEn, locale);
  return name ? `${entry.costItemCode} ${name}` : entry.costItemCode;
}
