// Stage 2 of the draft save: load the referenced cost items, then resolve every
// section + line in memory (cost by the F1 stable-id rule, price/unit from the
// line or the price book) and compute each line + section total.
import { costItems, type CostItemUnit, type MetraDb } from '@metra/db';
import { inArray } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import {
  computeLine,
  computeSection,
  type LineTotals,
  type SectionTotals,
} from '@/lib/aggregates/proposal-totals';
import {
  normalizeMoney,
  normalizeText,
  pctInRange,
  withinMagnitude,
  type SectionInput,
} from './core';

interface CostItemResolved {
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  nameEn: string | null;
  nameAr: string | null;
}

export interface ResolvedLine {
  costItemId: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  qty: string;
  unit: CostItemUnit;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
  lineCost: string;
  lineTotal: string;
  lineMargin: string;
  sortOrder: number;
}

export interface ResolvedSection {
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  subtotal: string;
  lines: ResolvedLine[];
}

/** One lookup for every referenced cost item; validates each exists + is active. */
export async function loadCostItemMap(
  tx: MetraDb,
  sections: SectionInput[],
): Promise<Map<string, CostItemResolved>> {
  const costItemIds = [
    ...new Set(
      sections.flatMap((section) =>
        section.lines
          .map((line) => line.costItemId?.trim())
          .filter((id): id is string => !!id),
      ),
    ),
  ];
  const costItemMap = new Map<string, CostItemResolved>();
  if (costItemIds.length) {
    const costItemRows = await tx
      .select()
      .from(costItems)
      .where(inArray(costItems.id, costItemIds));
    for (const costItem of costItemRows) {
      if (!costItem.active) fail('invalid');
      costItemMap.set(costItem.id, costItem);
    }
    for (const costItemId of costItemIds) {
      if (!costItemMap.has(costItemId)) fail('invalid');
    }
  }
  return costItemMap;
}

/**
 * Resolve every section + line in memory (cost by F1 stable-id rule, price/unit
 * from the line or the price book), computing each line + section total. Pure
 * (no DB) — the caller batches the writes afterwards.
 */
export function resolveDraftLines(
  sections: SectionInput[],
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): { resolvedSections: ResolvedSection[]; sectionTotals: SectionTotals[] } {
  const resolvedSections: ResolvedSection[] = [];
  const sectionTotals: SectionTotals[] = [];

  for (const [sectionIndex, section] of sections.entries()) {
    const sectionTitleEn = normalizeText(section.titleEn);
    const sectionTitleAr = normalizeText(section.titleAr);
    if (!sectionTitleEn && !sectionTitleAr) fail('name_required');

    const lineTotals: LineTotals[] = [];
    const lines: ResolvedLine[] = [];
    for (const [lineIndex, line] of section.lines.entries()) {
      const costItemId = line.costItemId?.trim() || null;
      const costItem = costItemId ? costItemMap.get(costItemId) : undefined;
      const resolvedUnit = line.unit ?? costItem?.unit ?? null;
      const resolvedUnitPrice =
        line.unitPrice ?? costItem?.defaultUnitPrice ?? null;
      const descriptionEn =
        normalizeText(line.descriptionEn) ?? costItem?.nameEn ?? null;
      const descriptionAr =
        normalizeText(line.descriptionAr) ?? costItem?.nameAr ?? null;

      // F1 cost resolution by stable identity.
      const lineId = line.id?.trim() || null;
      const isExisting = !!lineId && costSnapshot.has(lineId);
      let rawCost: string | null;
      if (isExisting) {
        rawCost = seeMargin
          ? (line.unitCost ?? costSnapshot.get(lineId!)!)
          : costSnapshot.get(lineId!)!;
      } else {
        rawCost = costItemId
          ? costItem!.defaultUnitCost
          : seeMargin
            ? line.unitCost || '0'
            : '0';
      }

      const qty = normalizeMoney(line.qty);
      const unitCost = normalizeMoney(rawCost);
      const unitPrice = normalizeMoney(resolvedUnitPrice);
      const discountPct = normalizeMoney(line.discountPct);
      if (
        qty === null ||
        unitCost === null ||
        unitPrice === null ||
        discountPct === null ||
        !resolvedUnit ||
        (!descriptionEn && !descriptionAr)
      ) {
        fail('line_required');
      }
      if (
        !withinMagnitude(qty!) ||
        !withinMagnitude(unitCost!) ||
        !withinMagnitude(unitPrice!)
      ) {
        fail('amount_too_large');
      }
      if (!pctInRange(discountPct!)) fail('discount_out_of_range');

      const totals = computeLine({
        qty: qty!,
        unitCost: unitCost!,
        unitPrice: unitPrice!,
        discountPct: discountPct!,
      });
      lineTotals.push(totals);
      lines.push({
        costItemId,
        descriptionAr,
        descriptionEn,
        qty: qty!,
        unit: resolvedUnit!,
        unitCost: unitCost!,
        unitPrice: unitPrice!,
        discountPct: discountPct!,
        lineCost: totals.lineCost,
        lineTotal: totals.lineTotal,
        lineMargin: totals.lineMargin,
        sortOrder: line.sortOrder ?? lineIndex,
      });
    }
    const sectionSubtotals = computeSection(lineTotals);
    sectionTotals.push(sectionSubtotals);
    resolvedSections.push({
      titleAr: sectionTitleAr,
      titleEn: sectionTitleEn,
      sortOrder: section.sortOrder ?? sectionIndex,
      subtotal: sectionSubtotals.sectionSubtotal,
      lines,
    });
  }

  return { resolvedSections, sectionTotals };
}
