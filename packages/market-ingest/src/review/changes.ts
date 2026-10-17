// Two review.html sections about what a bulletin changes beyond prices: the
// rows the owner skipped (mapping.json, with the reason), and the printed
// details (names, spec, unit label, basis note) that differ from what studios
// see now. Publishing the newest bulletin replaces those details; the old ones
// stay on file per bulletin (market_item_details).
import type { ItemDetails } from '../check/context';
import { basisDiffers } from '../check/page-notes';
import { ltr, section, table, type Cell } from './html-parts';
import type { ReviewInput } from './sections';

export function skippedSection(input: ReviewInput): string {
  const skipped = input.context?.skippedRows ?? [];
  return section('skipped', 'Skipped rows (mapping.json, not published)', table(
    ['page', 'row', 'item', 'reason'],
    skipped.map((row) => [ltr(row.pageId), ltr(row.rowId), row.labelAr, row.reason]),
  ), skipped.length);
}

const FIELDS: Array<[keyof ItemDetails, string]> = [
  ['nameAr', 'name (ar)'], ['nameEn', 'name (en)'], ['specAr', 'spec (ar)'], ['specEn', 'spec (en)'],
  ['unitLabelAr', 'unit label'], ['basisNoteAr', 'basis note'],
];

export function detailChangesSection(input: ReviewInput): string {
  const rows: Array<Array<Cell | string>> = [];
  for (const resolved of input.context?.rows ?? []) {
    const published = input.history.items.get(resolved.itemKey);
    if (!published) continue;
    const now: ItemDetails = {
      nameAr: resolved.row.labelAr, nameEn: resolved.row.nameEn, specAr: resolved.row.specAr, specEn: resolved.row.specEn,
      unitLabelAr: resolved.row.unitLabelAr, basisNoteAr: basisDiffers(resolved.page) ? resolved.page.basisNoteAr : null,
    };
    for (const [field, label] of FIELDS) {
      if (published.details[field] !== now[field]) {
        rows.push([ltr(resolved.itemKey), label, published.details[field] ?? '-', now[field] ?? '-', ltr(resolved.pageId)]);
      }
    }
  }
  return section('details', 'Item details that change', table(['key', 'field', 'studios see now', 'this bulletin', 'page'], rows), rows.length);
}
