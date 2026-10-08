// The builder's editable state, from the stored document and for a new line,
// and the live totals over it. PURE and CLIENT-SAFE (no React).
import { computeSection, computeTotals } from '@/lib/aggregates/proposal-totals';
import type { ProposalDetail } from '@/lib/proposals/queries';
import {
  figureOf,
  newLineKey,
  newSectionKey,
  previewLine,
  type CostItemOption,
  type LineState,
  type SectionState,
} from './builder-model';

/** A blank line, or one seeded from the price book. */
export function newLine(costItem?: CostItemOption): LineState {
  return {
    key: newLineKey(),
    id: null,
    costItemId: costItem?.id ?? null,
    descriptionEn: costItem?.nameEn ?? '',
    descriptionAr: costItem?.nameAr ?? '',
    qty: '1',
    unit: costItem?.unit ?? 'sqm',
    unitCost: costItem?.defaultUnitCost ?? '0',
    unitPrice: costItem?.defaultUnitPrice ?? '0',
    discountPct: '0',
  };
}

/** A blank section, not yet stored. */
export function newSection(): SectionState {
  return { key: newSectionKey(), id: null, titleEn: '', titleAr: '', lines: [] };
}

/** The stored document, as the editable shape. */
export function draftFromDetail(detail: ProposalDetail): SectionState[] {
  return detail.sections.map((section) => ({
    key: newSectionKey(),
    id: section.id,
    titleEn: section.titleEn ?? '',
    titleAr: section.titleAr ?? '',
    lines: section.lines.map((line) => ({
      key: newLineKey(),
      id: line.id,
      costItemId: line.costItemId,
      descriptionEn: line.descriptionEn ?? '',
      descriptionAr: line.descriptionAr ?? '',
      qty: line.qty,
      unit: line.unit,
      unitCost: line.unitCost ?? '0',
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
    })),
  }));
}

/** Live totals. `previewLine` coerces exactly as the server would, so what the
 *  studio steers by is what will be stored. */
export function computeDraftTotals(
  sections: SectionState[],
  header: { discountPct: string; taxRate: string; supervisionPct: string },
) {
  const sectionTotals = sections.map((section) =>
    computeSection(section.lines.map(previewLine)),
  );
  const doc = computeTotals(sectionTotals, {
    discountPct: figureOf(header.discountPct) || '0',
    taxRate: figureOf(header.taxRate) || '0',
    supervisionPct: figureOf(header.supervisionPct) || '0',
  });
  return { sectionTotals, doc };
}
