// Stage 2 of the draft save: resolve every section and its lines in memory, and
// compute each section total. PURE (no DB) — the caller batches the writes
// afterwards, so a refusal here costs nothing. Every refusal comes back at once,
// by POSITION on the wire (`sections.<s>.name`, `lines.<s>.<l>.<cell>`): the
// builder maps each position to its row's key using the draft it sent.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import type { LineTotals, SectionTotals } from '@/lib/aggregates/proposal-totals';
import { clean } from '@/lib/validation/text';
import { computeSectionWithinCap } from './draft-save-caps';
import type { CostItemResolved } from './draft-save-cost-items';
import { resolveDraftLine, type ResolvedLine } from './draft-save-resolve-line';
import type { SectionInput } from './types';

export type { ResolvedLine } from './draft-save-resolve-line';

export interface ResolvedSection {
  /** The id the payload named this section by; a STORED one is kept (./draft-save-diff). */
  id?: string;
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  subtotal: string;
  lines: ResolvedLine[];
}

/** The section id the payload sent, trimmed; absent when blank. */
function sectionIdOf(section: SectionInput): string | undefined {
  const id = typeof section.id === 'string' ? section.id.trim() : '';
  return id || undefined;
}

/** One section and every line under it, or the refusals they carry (added to
 *  `errors`). `sortOrder` falls back to its position. */
function resolveDraftSection(
  section: SectionInput,
  index: number,
  lookups: { costItemMap: Map<string, CostItemResolved>; costSnapshot: Map<string, string>; seeMargin: boolean },
  errors: Record<string, FieldError>,
): { section: ResolvedSection; totals: SectionTotals } | null {
  const titleEn = clean(section.titleEn);
  const titleAr = clean(section.titleAr);
  if (!titleEn && !titleAr) errors[`sections.${index}.name`] = { code: 'name_required' };

  const resolved: { line: ResolvedLine; totals: LineTotals }[] = [];
  section.lines.forEach((line, lineIndex) => {
    const entry = resolveDraftLine(line, lineIndex, lookups.costItemMap, lookups.costSnapshot, lookups.seeMargin);
    if (entry.ok) resolved.push(entry);
    else {
      for (const [cell, error] of Object.entries(entry.errors)) {
        errors[`lines.${index}.${lineIndex}.${cell}`] = error;
      }
    }
  });
  if ((!titleEn && !titleAr) || resolved.length < section.lines.length) return null;
  const totals = computeSectionWithinCap(resolved.map((entry) => entry.totals));
  return {
    totals,
    section: {
      id: sectionIdOf(section),
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
 * still names lines the server knows. `errors` holds every refusal; when it is
 * not empty the sections are incomplete and must not be stored.
 */
export function resolveDraftLines(
  sections: SectionInput[],
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): { resolvedSections: ResolvedSection[]; sectionTotals: SectionTotals[]; errors: FieldErrors } {
  const errors: Record<string, FieldError> = {};
  const lookups = { costItemMap, costSnapshot, seeMargin };
  const resolved = sections.flatMap((section, index) => {
    const entry = resolveDraftSection(section, index, lookups, errors);
    return entry ? [entry] : [];
  });
  return {
    resolvedSections: keepEachStoredIdOnce(resolved.map((entry) => entry.section)),
    sectionTotals: resolved.map((entry) => entry.totals),
    errors,
  };
}
