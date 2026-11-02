// The pure rules behind the section-title combobox (section-combobox.tsx): how
// an option is labelled, which saved titles the typed text narrows to, and
// whether a typed name is already saved. Client-safe; no React.
import type { SectionOption } from './section-combobox';

/** How many suggestions the list shows at most. */
const SUGGESTION_LIMIT = 8;

/** The option's title in the page's language, falling back to the other. */
export function sectionLabel(o: SectionOption, isAr: boolean): string {
  return (isAr ? o.nameAr || o.nameEn : o.nameEn || o.nameAr) ?? '';
}

/** The saved titles the typed text matches (either language), capped for the list. */
export function filterSectionOptions(
  options: SectionOption[],
  current: string,
): SectionOption[] {
  const q = current.trim().toLowerCase();
  const list = q
    ? options.filter(
        (o) =>
          (o.nameEn ?? '').toLowerCase().includes(q) ||
          (o.nameAr ?? '').toLowerCase().includes(q),
      )
    : options;
  return list.slice(0, SUGGESTION_LIMIT);
}

/** Whether a saved title in the typed language equals the (trimmed) name. */
export function isSavedSectionName(
  options: SectionOption[],
  name: string,
  isAr: boolean,
): boolean {
  return options.some(
    (o) =>
      (isAr ? o.nameAr : o.nameEn)?.trim().toLowerCase() === name.toLowerCase(),
  );
}
