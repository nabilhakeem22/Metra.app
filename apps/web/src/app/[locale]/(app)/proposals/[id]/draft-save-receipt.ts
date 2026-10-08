// What a save's receipt means for the builder's rows. PURE and CLIENT-SAFE.
//
// The server answers each save with the id it stored every section and line
// under, in the order the save sent them (a kept id, or a fresh one for a new
// row). Mapped back through the SAVED draft's keys, that tells the builder which
// of its rows is now a stored one, even if rows were added, moved or removed
// while the save ran. Section keys and line keys never collide (builder-model.ts),
// so one map carries both.
import type { SaveDraftActionResult } from '@/lib/proposals/actions';
import type { SectionState } from './builder-model';

type DraftSaveReceipt = NonNullable<SaveDraftActionResult['data']>;

/** `SectionState.key` and `LineState.key` -> the id the receipt stored that row under. */
export function storedIdsByKey(
  saved: readonly SectionState[],
  receipt: DraftSaveReceipt,
): Map<string, string> {
  const ids = new Map<string, string>();
  saved.forEach((section, sectionIndex) => {
    const storedSection = receipt.sections[sectionIndex];
    if (storedSection?.id) ids.set(section.key, storedSection.id);
    const storedLines = storedSection?.lineIds ?? [];
    section.lines.forEach((line, lineIndex) => {
      const id = storedLines[lineIndex];
      if (id) ids.set(line.key, id);
    });
  });
  return ids;
}

/** The sections and lines with each keyed row carrying its stored id. Unchanged rows keep identity. */
export function withStoredIds(
  sections: SectionState[],
  idsByKey: ReadonlyMap<string, string>,
): SectionState[] {
  const changed = (row: { key: string; id: string | null }) =>
    idsByKey.has(row.key) && idsByKey.get(row.key) !== row.id;
  return sections.map((section) => {
    if (!changed(section) && !section.lines.some(changed)) return section;
    const sectionId = idsByKey.get(section.key) ?? section.id;
    return {
      ...section,
      id: sectionId,
      lines: section.lines.some(changed)
        ? section.lines.map((line) => (changed(line) ? { ...line, id: idsByKey.get(line.key)! } : line))
        : section.lines,
    };
  });
}
