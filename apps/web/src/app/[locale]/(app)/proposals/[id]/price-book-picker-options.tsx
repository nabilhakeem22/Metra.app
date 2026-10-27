'use client';

import type { useTranslations } from 'next-intl';
import { ListboxOption } from '@/components/ui/listbox-option';
import { cn } from '@/lib/utils';
import type { CostItemOption } from './builder-model';
import { optionIdOf, type PickerList } from './price-book-picker-model';

/**
 * The picker's listbox: the groups of the answer under their section title,
 * each entry one option whose DOM id is its position across all the groups
 * (the input names the active one via aria-activedescendant). The parent owns
 * the active index, the pick and the hover.
 */
export function PriceBookPickerOptions({
  list,
  listId,
  active,
  stale,
  onPick,
  onHover,
  t,
}: {
  list: PickerList;
  listId: string;
  active: number;
  stale: boolean;
  onPick: (item: CostItemOption) => void;
  onHover: (index: number) => void;
  t: ReturnType<typeof useTranslations<'proposals.builder'>>;
}) {
  let position = -1;
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={t('fromPriceBook')}
      aria-busy={stale}
      className={cn('mt-2 max-h-72 overflow-auto', stale && 'opacity-60')}
    >
      {list.groups.map((group) => (
        <li key={group.sectionId ?? 'other'} role="presentation">
          <p className="px-2 pb-1 pt-2 text-caption font-medium text-muted-foreground">{group.title ?? t('priceBookOther')}</p>
          <ul role="presentation">
            {group.entries.map((entry) => {
              position += 1;
              const index = position;
              return (
                <ListboxOption
                  key={entry.item.id}
                  id={optionIdOf(listId, index)}
                  active={index === active}
                  className="items-baseline justify-between gap-3 px-2"
                  onPick={() => onPick(entry.item)}
                  onHover={() => onHover(index)}
                >
                  <span>{entry.name}</span>
                  <span className="shrink-0 text-caption text-muted-foreground" dir="ltr">
                    {entry.item.code}
                  </span>
                </ListboxOption>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
