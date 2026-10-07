// What a save's receipt means for the builder's rows. PURE and CLIENT-SAFE.
//
// The server answers each save with the id it stored every line under, in the
// order the save sent them (a kept id, or a fresh one for a new line). Mapped back
// through the SAVED draft's line keys, that tells the builder which of its rows is
// now a stored line, even if rows were added, moved or removed while the save ran.
import type { SaveDraftActionResult } from '@/lib/proposals/actions';
import type { SectionState } from './builder-model';

type DraftSaveReceipt = NonNullable<SaveDraftActionResult['data']>;

/** `LineState.key` -> the id the receipt stored that line under. */
export function lineIdsByKey(
  saved: readonly SectionState[],
  receipt: DraftSaveReceipt,
): Map<string, string> {
  const ids = new Map<string, string>();
  saved.forEach((section, sectionIndex) => {
    const stored = receipt.sections[sectionIndex]?.lineIds ?? [];
    section.lines.forEach((line, lineIndex) => {
      const id = stored[lineIndex];
      if (id) ids.set(line.key, id);
    });
  });
  return ids;
}

/** The sections with each keyed line carrying its stored id. Unchanged rows keep identity. */
export function withLineIds(
  sections: SectionState[],
  idsByKey: ReadonlyMap<string, string>,
): SectionState[] {
  return sections.map((section) => {
    if (!section.lines.some((line) => idsByKey.has(line.key) && idsByKey.get(line.key) !== line.id)) {
      return section;
    }
    return {
      ...section,
      lines: section.lines.map((line) => {
        const id = idsByKey.get(line.key);
        return id && id !== line.id ? { ...line, id } : line;
      }),
    };
  });
}
