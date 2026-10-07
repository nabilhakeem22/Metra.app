// Stage 2 of the draft save: resolve every section and its lines in memory, and
// compute each section total. PURE (no DB) — the caller batches the writes
// afterwards, so a coded refusal here costs nothing.
import { fail } from '@/lib/actions/mutate';
import type { SectionTotals } from '@/lib/aggregates/proposal-totals';
import { clean } from '@/lib/validation/text';
import { computeSectionWithinCap } from './draft-save-caps';
import type { CostItemResolved } from './draft-save-cost-items';
import { resolveDraftLine, type ResolvedLine } from './draft-save-resolve-line';
import type { SectionInput } from './types';

export type { ResolvedLine } from './draft-save-resolve-line';
export { loadCostItemMap } from './draft-save-cost-items';

export interface ResolvedSection {
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  subtotal: string;
  lines: ResolvedLine[];
}

/** One section and every line under it. `sortOrder` falls back to its position. */
function resolveDraftSection(
  section: SectionInput,
  index: number,
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): { section: ResolvedSection; totals: SectionTotals } {
  const titleEn = clean(section.titleEn);
  const titleAr = clean(section.titleAr);
  if (!titleEn && !titleAr) fail('name_required');

  const resolved = section.lines.map((line, lineIndex) =>
    resolveDraftLine(line, lineIndex, costItemMap, costSnapshot, seeMargin),
  );
  const totals = computeSectionWithinCap(resolved.map((entry) => entry.totals));
  return {
    totals,
    section: {
      titleAr,
      titleEn,
      sortOrder: section.sortOrder ?? index,
      subtotal: totals.sectionSubtotal,
      lines: resolved.map((entry) => entry.line),
    },
  };
}

/**
 * One stored id, one line. A payload that names the same stored line twice keeps
 * the id on the FIRST and gives the repeat a fresh one, so the rebuild never
 * inserts two rows under one primary key.
 */
function keepEachStoredIdOnce(sections: ResolvedSection[]): ResolvedSection[] {
  const kept = new Set<string>();
  return sections.map((section) => ({
    ...section,
    lines: section.lines.map((line) => {
      if (!line.id) return line;
      if (!kept.has(line.id)) {
        kept.add(line.id);
        return line;
      }
      return { ...line, id: undefined };
    }),
  }));
}

/**
 * Resolve every section + line (cost by the F1 stable-id rule, price/unit from
 * the line or the price book), computing each line + section total. A stored
 * line keeps its id, so a builder that saves again without reloading (autosave)
 * still names lines the server knows.
 */
export function resolveDraftLines(
  sections: SectionInput[],
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): { resolvedSections: ResolvedSection[]; sectionTotals: SectionTotals[] } {
  const resolved = sections.map((section, index) =>
    resolveDraftSection(section, index, costItemMap, costSnapshot, seeMargin),
  );
  return {
    resolvedSections: keepEachStoredIdOnce(resolved.map((entry) => entry.section)),
    sectionTotals: resolved.map((entry) => entry.totals),
  };
}
