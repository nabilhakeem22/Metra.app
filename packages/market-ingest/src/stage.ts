// staged.json: the canonical, key-sorted, resolved bulletin that the owner
// approves by its sha256 and `market:publish` writes. It carries no producer
// free text (notes, rule, confidence, verbatim cells, MD tokens). While any
// blocking finding remains it carries NO data at all, so a refused value can
// never reach it or the database.
import type { Finding } from './findings';
import { isBlocking } from './findings';
import type { ReadFrom, SourceV1 } from './format';
import { basisDiffers } from './check/page-notes';
import { monthKey, type CheckContext } from './check/context';
import { sourceLabelOf } from './normalize';
import { byCodePoint } from './order';
import { categoriesFor, topOf } from './taxonomy';
import { marketUnitOf, type MarketUnit } from './units';

export const STAGED_FORMAT = 'metra.market-staged.v1';

export interface StagedCategory {
  key: string;
  parentKey: string | null;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

export interface StagedItem {
  key: string;
  categoryKey: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  unit: MarketUnit;
  unitLabelAr: string;
  basisNoteAr: string | null;
  sourceLabel: string;
}

export interface StagedObservation {
  itemKey: string;
  /** 'YYYY-MM'. */
  month: string;
  status: 'priced' | 'suspended';
  price: string | null;
  pdfPage: number | null;
  printedPage: number | null;
}

export interface StagedBulletin {
  format: typeof STAGED_FORMAT;
  publisher: 'mhuc_cabm';
  period: string;
  readFrom: ReadFrom | null;
  source: SourceV1 | null;
  blocking: Finding[];
  categories: StagedCategory[];
  items: StagedItem[];
  observations: StagedObservation[];
  discontinue: string[];
}

function stagedData(context: CheckContext): Pick<StagedBulletin, 'categories' | 'items' | 'observations' | 'discontinue'> {
  const items: StagedItem[] = [];
  const observations: StagedObservation[] = [];
  for (const { row, page, itemKey, months } of context.rows) {
    items.push({
      key: itemKey,
      categoryKey: page.subCategoryKey,
      nameAr: row.labelAr,
      nameEn: row.nameEn,
      specAr: row.specAr,
      specEn: row.specEn,
      unit: marketUnitOf(row.unitLabelAr) as MarketUnit,
      unitLabelAr: row.unitLabelAr,
      basisNoteAr: basisDiffers(page) ? page.basisNoteAr : null,
      sourceLabel: sourceLabelOf(row.labelAr, row.specAr),
    });
    months.forEach((slot, index) => {
      if (slot === null) return;
      observations.push({
        itemKey,
        month: monthKey(context.file, index + 1),
        status: slot === 'suspended' ? 'suspended' : 'priced',
        price: slot === 'suspended' ? null : slot,
        pdfPage: page.pdfPage,
        printedPage: page.printedPage,
      });
    });
  }
  const categories = categoriesFor(items.map((item) => item.categoryKey)).map((category) => ({
    key: category.key,
    parentKey: category.key.includes('.') ? topOf(category.key) : null,
    nameAr: category.nameAr,
    nameEn: category.nameEn,
    sortOrder: category.sortOrder,
  }));
  return {
    categories,
    items: items.sort((a, b) => byCodePoint(a.key, b.key)),
    observations: observations.sort((a, b) => byCodePoint(a.itemKey, b.itemKey) || byCodePoint(a.month, b.month)),
    discontinue: context.discontinueKeys,
  };
}

export function buildStaged(period: string, context: CheckContext | null, findings: Finding[]): StagedBulletin {
  const blocking = findings.filter(isBlocking);
  const empty = { categories: [], items: [], observations: [], discontinue: [] };
  return {
    format: STAGED_FORMAT,
    publisher: 'mhuc_cabm',
    period,
    readFrom: context?.file.readFrom ?? null,
    source: context?.file.source ?? null,
    blocking,
    ...(context === null || blocking.length > 0 ? empty : stagedData(context)),
  };
}
