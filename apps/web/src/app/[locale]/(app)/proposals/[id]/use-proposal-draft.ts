'use client';

import { useMemo, useState } from 'react';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { move, type CostItemOption, type LineState, type SectionState } from './builder-model';
import { withLineIds } from './draft-save-receipt';
import { computeDraftTotals, draftFromDetail, newLine } from './draft-state';

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
  /** Give lines the ids a save stored them under, by `LineState.key`. */
  adoptLineIds: (idsByKey: ReadonlyMap<string, string>) => void;
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
    adoptLineIds: (idsByKey) =>
      setSections((current) => withLineIds(current, idsByKey)),
  };
}
