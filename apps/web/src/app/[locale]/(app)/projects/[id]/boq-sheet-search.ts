import type { BoqDetail, BoqLineRow, BoqSectionRow } from '@/lib/boqs/queries';
import type { EditableLine } from './boq-sheet-columns';

// Finding a line in a BOQ. PURE, and a plain module rather than a `useMemo` in a
// render body: "which lines does this search show" is a product rule about what a
// studio can find, and a rule nobody can call is a rule nobody can test.

/** Lower-cased and trimmed. An empty needle matches everything. */
export function searchNeedle(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * A line matches on its CODE or its DESCRIPTION. A studio hunting for "2.03"
 * types the code; one hunting for gypsum types the word — and the two live in
 * different columns, so both are searched as one string.
 */
export function matchesNeedle(line: BoqLineRow, needle: string): boolean {
  if (needle === '') return true;
  return `${line.itemCode ?? ''} ${line.description}`.toLowerCase().includes(needle);
}

/** The section's matching lines, each remembering which section it came from. */
export function visibleLines(section: BoqSectionRow, needle: string): EditableLine[] {
  return section.lines
    .map((line) => ({ ...line, sectionId: section.id }))
    .filter((line) => matchesNeedle(line, needle));
}

/** What the header's line count reports: the number of lines ACTUALLY on screen. */
export function countVisibleLines(boq: BoqDetail, needle: string): number {
  return boq.sections.reduce(
    (total, section) => total + visibleLines(section, needle).length,
    0,
  );
}
