// What the builder's "From price book" picker lists: the studio's active items
// grouped by price-book section, sections and items ordered by name in the
// page's language, filtered by what is typed (name in either language, or
// code). Pure and client-safe. Capped, so a book of 450+ items renders a short
// list and asks for a few letters instead of drawing every row.
import { byName, nameIn, searchForm } from '@/lib/price-book/name-order';
import type { CostItemOption } from './builder-model';
import type { SectionOption } from './section-combobox';

export interface PickerEntry {
  item: CostItemOption;
  name: string;
}

export interface PickerGroup {
  /** The section id, or null for items whose section the builder does not know. */
  sectionId: string | null;
  title: string | null;
  entries: PickerEntry[];
}

export interface PickerList {
  groups: PickerGroup[];
  /** How many items matched, shown or not. */
  matched: number;
  /** How many matched items the cap left out. */
  hidden: number;
}

export const PICKER_LIMIT = 60;

function matches(item: CostItemOption, needle: string): boolean {
  return needle === '' || searchForm(`${item.nameAr ?? ''} ${item.nameEn ?? ''} ${item.code}`).includes(needle);
}

export function pickerList(items: readonly CostItemOption[], sections: readonly SectionOption[], locale: string, query: string): PickerList {
  const needle = searchForm(query);
  const order = byName(locale);
  const known = new Map(sections.map((section) => [section.id, section]));
  const found = items.filter((item) => matches(item, needle));
  const bySection = new Map<string | null, CostItemOption[]>();
  for (const item of found) {
    const key = item.sectionId !== null && known.has(item.sectionId) ? item.sectionId : null;
    bySection.set(key, [...(bySection.get(key) ?? []), item]);
  }
  const orderedSections = [...known.values()].filter((section) => bySection.has(section.id)).sort(order);
  const ordered: PickerGroup[] = [
    ...orderedSections.map((section) => ({ sectionId: section.id, title: nameIn(section, locale), entries: [] as PickerEntry[] })),
    ...(bySection.has(null) ? [{ sectionId: null, title: null, entries: [] as PickerEntry[] }] : []),
  ];
  let room = PICKER_LIMIT;
  for (const group of ordered) {
    const sorted = [...(bySection.get(group.sectionId) ?? [])].sort(order);
    group.entries = sorted.slice(0, Math.max(room, 0)).map((item) => ({ item, name: nameIn(item, locale) || item.code }));
    room -= group.entries.length;
  }
  const groups = ordered.filter((group) => group.entries.length > 0);
  const shown = groups.reduce((sum, group) => sum + group.entries.length, 0);
  return { groups, matched: found.length, hidden: found.length - shown };
}
