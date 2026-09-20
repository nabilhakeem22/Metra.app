'use client';

import { useMemo, useState } from 'react';
import { computeSection, computeTotals } from '@/lib/aggregates/proposal-totals';
import type { ProposalDetail } from '@/lib/proposals/queries';
import {
  move,
  previewLine,
  type CostItemOption,
  type LineState,
  type SectionState,
} from './builder-model';

/** Everything the builder holds while a studio is editing, and nothing else. */
export interface ProposalDraftApi {
  discountPct: string;
  setDiscountPct: (value: string) => void;
  taxRate: string;
  setTaxRate: (value: string) => void;
  supervisionPct: string;
  setSupervisionPct: (value: string) => void;
  sections: SectionState[];
  totals: ReturnType<typeof computeDraftTotals>;
  patchSection: (sectionIndex: number, patch: Partial<SectionState>) => void;
  patchLine: (sectionIndex: number, lineIndex: number, patch: Partial<LineState>) => void;
  addSection: () => void;
  removeSection: (sectionIndex: number) => void;
  addLine: (sectionIndex: number, costItem?: CostItemOption) => void;
  removeLine: (sectionIndex: number, lineIndex: number) => void;
  moveSection: (sectionIndex: number, direction: -1 | 1) => void;
}

/** A blank line, or one seeded from the price book. */
function newLine(costItem?: CostItemOption): LineState {
  return {
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

/** The stored document, as the editable shape. */
function draftFromDetail(detail: ProposalDetail): SectionState[] {
  return detail.sections.map((section) => ({
    titleEn: section.titleEn ?? '',
    titleAr: section.titleAr ?? '',
    lines: section.lines.map((line) => ({
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
function computeDraftTotals(
  sections: SectionState[],
  header: { discountPct: string; taxRate: string; supervisionPct: string },
) {
  const sectionTotals = sections.map((section) =>
    computeSection(section.lines.map(previewLine)),
  );
  const doc = computeTotals(sectionTotals, {
    discountPct: header.discountPct || '0',
    taxRate: header.taxRate || '0',
    supervisionPct: header.supervisionPct || '0',
  });
  return { sectionTotals, doc };
}

export function useProposalDraft(detail: ProposalDetail): ProposalDraftApi {
  const [discountPct, setDiscountPct] = useState(detail.discountPct);
  const [taxRate, setTaxRate] = useState(detail.taxRate);
  const [supervisionPct, setSupervisionPct] = useState(detail.supervisionPct);
  const [sections, setSections] = useState<SectionState[]>(() => draftFromDetail(detail));

  const totals = useMemo(
    () => computeDraftTotals(sections, { discountPct, taxRate, supervisionPct }),
    [sections, discountPct, taxRate, supervisionPct],
  );

  function patchSection(sectionIndex: number, patch: Partial<SectionState>): void {
    setSections((current) =>
      current.map((section, index) =>
        index === sectionIndex ? { ...section, ...patch } : section,
      ),
    );
  }

  function patchLine(
    sectionIndex: number,
    lineIndex: number,
    patch: Partial<LineState>,
  ): void {
    setSections((current) =>
      current.map((section, index) =>
        index !== sectionIndex
          ? section
          : {
              ...section,
              lines: section.lines.map((line, j) =>
                j === lineIndex ? { ...line, ...patch } : line,
              ),
            },
      ),
    );
  }

  /**
   * Rewrite ONE section's lines, FROM THE LINES IT HAS RIGHT NOW.
   *
   * `addLine` and `removeLine` used to read `sections` out of the render closure
   * and hand the result to `patchSection` (W5 R7). Two `addLine` calls in one
   * frame therefore both started from the SAME array, and the second overwrote
   * the first: one of the two lines was simply gone, with no error and nothing
   * on screen to say a click had done nothing. The updater form is the whole
   * fix — `current` inside `setSections` is the latest state, queued updates
   * included.
   */
  function replaceLines(
    sectionIndex: number,
    change: (lines: LineState[]) => LineState[],
  ): void {
    setSections((current) =>
      current.map((section, index) =>
        index === sectionIndex ? { ...section, lines: change(section.lines) } : section,
      ),
    );
  }

  return {
    discountPct,
    setDiscountPct,
    taxRate,
    setTaxRate,
    supervisionPct,
    setSupervisionPct,
    sections,
    totals,
    patchSection,
    patchLine,
    addSection: () =>
      setSections((current) => [...current, { titleEn: '', titleAr: '', lines: [] }]),
    removeSection: (sectionIndex) =>
      setSections((current) => current.filter((_, index) => index !== sectionIndex)),
    addLine: (sectionIndex, costItem) =>
      replaceLines(sectionIndex, (lines) => [...lines, newLine(costItem)]),
    removeLine: (sectionIndex, lineIndex) =>
      replaceLines(sectionIndex, (lines) => lines.filter((_, j) => j !== lineIndex)),
    moveSection: (sectionIndex, direction) =>
      setSections((current) => move(current, sectionIndex, direction)),
  };
}
