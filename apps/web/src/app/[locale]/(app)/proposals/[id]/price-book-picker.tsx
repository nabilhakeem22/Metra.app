'use client';

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CostItemOption } from './builder-model';
import { pickerList } from './price-book-picker-model';
import { PriceBookPickerOption } from './price-book-picker-option';
import { PriceBookPickerStatus } from './price-book-picker-status';
import type { SectionOption } from './section-combobox';
import { usePriceBookSearch } from './use-price-book-search';

const optionIdOf = (listId: string, index: number) => `${listId}-option-${index}`;

/**
 * "From price book": a light searchable list (no new dependency, like
 * SectionCombobox). Its items are asked of the server while it is open
 * (use-price-book-search), never carried in the page. Items read by NAME in the
 * page's language, the code beside it; grouped by price-book section; type to
 * narrow by name or code (every word, any order). Keyboard: the input keeps
 * focus and names the active option (aria-activedescendant), which scrolls into
 * view; Enter picks; Escape closes and returns focus to the button.
 */
export function PriceBookPicker({
  sections,
  onPick,
}: {
  sections: SectionOption[];
  onPick: (costItem: CostItemOption) => void;
}) {
  const t = useTranslations('proposals.builder');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const answer = usePriceBookSearch(open, query, locale);
  const list = useMemo(
    () => pickerList(answer.search?.items ?? [], sections, locale, answer.search?.matched ?? 0),
    [answer.search, sections, locale],
  );
  const flat = useMemo(() => list.groups.flatMap((group) => group.entries), [list]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionIdOf(listId, active))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function pick(item: CostItemOption) {
    onPick(item);
    setQuery('');
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((index) => Math.min(index + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // An answer still on its way would pick from the list of what WAS typed.
      if (!answer.stale && flat[active]) pick(flat[active].item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  let position = -1;
  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setActive(0);
          setOpen((was) => !was);
        }}
      >
        <Search className="size-4" aria-hidden />
        {t('fromPriceBook')}
      </Button>
      {open && (
        <div className="absolute start-0 z-20 mt-1 w-96 max-w-[90vw] border border-border bg-popover p-2 text-body shadow-card">
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat[active] ? optionIdOf(listId, active) : undefined}
            aria-label={t('priceBookSearch')}
            placeholder={t('priceBookSearch')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul
            id={listId}
            role="listbox"
            aria-label={t('fromPriceBook')}
            aria-busy={answer.stale}
            className={cn('mt-2 max-h-72 overflow-auto', answer.stale && 'opacity-60')}
          >
            {list.groups.map((group) => (
              <li key={group.sectionId ?? 'other'} role="presentation">
                <p className="px-2 pb-1 pt-2 text-caption font-medium text-muted-foreground">{group.title ?? t('priceBookOther')}</p>
                <ul role="presentation">
                  {group.entries.map((entry) => {
                    position += 1;
                    const index = position;
                    return (
                      <PriceBookPickerOption
                        key={entry.item.id}
                        id={optionIdOf(listId, index)}
                        name={entry.name}
                        code={entry.item.code}
                        active={index === active}
                        onPick={() => pick(entry.item)}
                        onHover={() => setActive(index)}
                      />
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <PriceBookPickerStatus answer={answer} matched={list.matched} hidden={list.hidden} />
        </div>
      )}
    </div>
  );
}
