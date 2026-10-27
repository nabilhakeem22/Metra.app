'use client';

import { ListboxOption } from '@/components/ui/listbox-option';
import { sectionLabel } from './section-combobox-filter';
import type { SectionOption } from './section-combobox';

/**
 * The combobox's suggestion list: one option per saved title that matches the
 * typed text, labelled in the page's language. The parent owns the active
 * index, the pick and the hover.
 */
export function SectionComboboxOptions({
  options,
  listId,
  active,
  isAr,
  onPick,
  onHover,
}: {
  options: SectionOption[];
  listId: string;
  active: number;
  isAr: boolean;
  onPick: (option: SectionOption) => void;
  onHover: (index: number) => void;
}) {
  return (
    <ul id={listId} role="listbox">
      {options.map((o, i) => (
        <ListboxOption
          key={o.id}
          active={i === active}
          dir={isAr ? 'rtl' : 'ltr'}
          className="items-center"
          onPick={() => onPick(o)}
          onHover={() => onHover(i)}
        >
          {sectionLabel(o, isAr)}
        </ListboxOption>
      ))}
    </ul>
  );
}
