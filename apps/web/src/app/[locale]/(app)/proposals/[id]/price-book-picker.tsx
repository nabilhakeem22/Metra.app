'use client';

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CostItemOption } from './builder-model';
import { pickerList } from './price-book-picker-model';
import type { SectionOption } from './section-combobox';

/**
 * "From price book": a light searchable list (no new dependency, like
 * SectionCombobox). Items read by NAME in the page's language, the code beside
 * it; grouped by price-book section; type to narrow by name or code; arrows
 * and Enter pick, Escape closes. Lists at most PICKER_LIMIT rows at a time.
 */
export function PriceBookPicker({
  costItems,
  sections,
  onPick,
}: {
  costItems: CostItemOption[];
  sections: SectionOption[];
  onPick: (costItem: CostItemOption) => void;
}) {
  const t = useTranslations('proposals.builder');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => pickerList(costItems, sections, locale, query), [costItems, sections, locale, query]);
  const flat = useMemo(() => list.groups.flatMap((group) => group.entries), [list]);
  const listId = useMemo(() => `pb-pick-${Math.random().toString(36).slice(2, 8)}`, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function pick(item: CostItemOption) {
    onPick(item);
    setOpen(false);
    setQuery('');
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
      if (flat[active]) pick(flat[active].item);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  let position = -1;
  return (
    <div ref={rootRef} className="relative">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((was) => !was)}>
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
            aria-label={t('priceBookSearch')}
            placeholder={t('priceBookSearch')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul id={listId} role="listbox" aria-label={t('fromPriceBook')} className="mt-2 max-h-72 overflow-auto">
            {list.groups.map((group) => (
              <li key={group.sectionId ?? 'other'} role="presentation">
                <p className="px-2 pb-1 pt-2 text-caption font-medium text-muted-foreground">{group.title ?? t('priceBookOther')}</p>
                <ul role="presentation">
                  {group.entries.map((entry) => {
                    position += 1;
                    const index = position;
                    return (
                      <li key={entry.item.id} role="option" aria-selected={index === active}>
                        <button
                          type="button"
                          className={cn(
                            'flex w-full items-baseline justify-between gap-3 px-2 py-1.5 text-start',
                            index === active ? 'bg-muted text-foreground' : 'text-popover-foreground',
                          )}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            pick(entry.item);
                          }}
                          onMouseEnter={() => setActive(index)}
                        >
                          <span>{entry.name}</span>
                          <span className="shrink-0 text-caption text-muted-foreground" dir="ltr">{entry.item.code}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {list.matched === 0 && <p className="px-2 py-2 text-caption text-muted-foreground">{t('priceBookNothing')}</p>}
          {list.hidden > 0 && <p className="px-2 pt-2 text-caption text-muted-foreground">{t('priceBookMore', { count: list.hidden })}</p>}
        </div>
      )}
    </div>
  );
}
