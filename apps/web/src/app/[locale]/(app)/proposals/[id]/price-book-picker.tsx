'use client';

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnchoredLayer } from '@/components/ui/anchored-layer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListboxOption } from '@/components/ui/listbox-option';
import { useOutsidePointerDown } from '@/hooks/use-outside-pointer-down';
import { cn } from '@/lib/utils';
import type { CostItemOption } from './builder-model';
import { pickerList } from './price-book-picker-model';
import { PriceBookPickerStatus } from './price-book-picker-status';
import type { SectionOption } from './section-combobox';
import { usePriceBookSearch } from './use-price-book-search';

const optionIdOf = (listId: string, index: number) => `${listId}-option-${index}`;
/** The panel's width (w-96), less on a narrow screen. */
const PANEL_WIDTH = 384;
/** The tallest the whole panel gets (search box, list, status line) before it scrolls. */
const PANEL_MAX_HEIGHT = 420;

/**
 * "From price book": a light searchable list (no new dependency, like
 * SectionCombobox). Its items are asked of the server while it is open
 * (use-price-book-search), never carried in the page. Items read by NAME in the
 * page's language, the code beside it; grouped by price-book section; type to
 * narrow by name or code (every word, any order). Keyboard: the input keeps
 * focus and names the active option (aria-activedescendant), which scrolls into
 * view; Enter picks; Escape closes and returns focus to the button, and so
 * does Tab, which then moves on from the button. The panel is an AnchoredLayer,
 * so the next card can never cover it.
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
  const layerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const answer = usePriceBookSearch(open, query, locale);
  const list = useMemo(
    () => pickerList(answer.search?.items ?? [], sections, locale, answer.search?.matched ?? 0),
    [answer.search, sections, locale],
  );
  const flat = useMemo(() => list.groups.flatMap((group) => group.entries), [list]);

  useOutsidePointerDown(open, [rootRef, layerRef], () => setOpen(false));

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
    } else if (e.key === 'Tab') {
      // The panel lives at the end of the page: leave from the button, so Tab
      // reaches the control after it and Shift+Tab lands on the button itself.
      if (e.shiftKey) e.preventDefault();
      close();
    }
  }

  let position = -1;
  return (
    <div ref={rootRef}>
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
        <AnchoredLayer
          anchorRef={triggerRef}
          layerRef={layerRef}
          width={PANEL_WIDTH}
          maxHeight={PANEL_MAX_HEIGHT}
          className="border border-border bg-popover p-2 text-body shadow-card"
        >
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
                      <ListboxOption
                        key={entry.item.id}
                        id={optionIdOf(listId, index)}
                        active={index === active}
                        className="items-baseline justify-between gap-3 px-2"
                        onPick={() => pick(entry.item)}
                        onHover={() => setActive(index)}
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
          <PriceBookPickerStatus answer={answer} matched={list.matched} hidden={list.hidden} />
        </AnchoredLayer>
      )}
    </div>
  );
}
