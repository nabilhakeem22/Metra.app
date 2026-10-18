// What the builder's "From price book" picker lists for one answer of the
// server (lib/price-book/picker-query.ts): the items under their section, in
// the order the server gave them (sections and items by name in the page's
// language, items whose section the builder does not know last). Pure and
// client-safe.
import { nameIn } from '@/lib/price-book/name-order';
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
  /** How many matched items the answer left out. */
  hidden: number;
}

export function pickerList(items: readonly CostItemOption[], sections: readonly SectionOption[], locale: string, matched: number): PickerList {
  const known = new Map(sections.map((section) => [section.id, section]));
  const groups: PickerGroup[] = [];
  for (const item of items) {
    const section = item.sectionId === null ? undefined : known.get(item.sectionId);
    const sectionId = section?.id ?? null;
    const entry = { item, name: nameIn(item, locale) || item.code };
    const group = groups.find((candidate) => candidate.sectionId === sectionId);
    if (group) group.entries.push(entry);
    else groups.push({ sectionId, title: section ? nameIn(section, locale) : null, entries: [entry] });
  }
  return { groups, matched, hidden: Math.max(matched - items.length, 0) };
}
