'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { AnchoredLayer } from '@/components/ui/anchored-layer';
import { Input } from '@/components/ui/input';
import { useOutsidePointerDown } from '@/hooks/use-outside-pointer-down';
import { filterSectionOptions, isSavedSectionName } from './section-combobox-filter';
import { SectionComboboxOptions } from './section-combobox-options';

export interface SectionOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

/** The tallest the suggestion list gets before it scrolls (max-h-56). */
const LIST_MAX_HEIGHT = 224;

/**
 * Section-title combobox (create-on-use). A single localized text field over a
 * lightweight list of saved titles (no cmdk, no Radix Popover), drawn in an
 * AnchoredLayer so the next card can never cover it. Picking an option fills
 * BOTH title fields; typing a brand-new name keeps it on the section and
 * fire-and-forgets onCreate so it joins the library. Filtering matches either
 * language. Logical CSS only.
 */
export function SectionCombobox({
  valueEn,
  valueAr,
  onChange,
  options,
  onCreate,
  locale,
  placeholder,
  className,
  'aria-describedby': describedBy,
}: {
  valueEn: string;
  valueAr: string;
  onChange: (patch: { titleEn: string; titleAr: string }) => void;
  options: SectionOption[];
  onCreate: (name: { nameEn: string | null; nameAr: string | null }) => void;
  locale: string;
  placeholder?: string;
  className?: string;
  'aria-describedby'?: string;
}) {
  const isAr = locale.startsWith('ar');
  const current = isAr ? valueAr : valueEn;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  // React's id: the same on the server and the client, so aria-controls survives hydration.
  const listId = useId();

  const filtered = useMemo(
    () => filterSectionOptions(options, current),
    [options, current],
  );

  // A press outside the field and its list closes the list.
  useOutsidePointerDown(open, [rootRef, layerRef], () => setOpen(false));

  function setTyped(v: string) {
    onChange({
      titleEn: isAr ? valueEn : v,
      titleAr: isAr ? v : valueAr,
    });
    setActive(0);
    setOpen(true);
  }

  function pick(o: SectionOption) {
    onChange({ titleEn: o.nameEn ?? '', titleAr: o.nameAr ?? '' });
    setOpen(false);
  }

  // On commit (Enter / blur): if the typed name matches no saved title in the
  // language it was typed, record it in the library. The section keeps the text.
  function maybeCreate() {
    const name = current.trim();
    if (!name) return;
    if (!isSavedSectionName(options, name, isAr)) {
      onCreate({ nameEn: isAr ? null : name, nameAr: isAr ? name : null });
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        pick(filtered[active]);
      } else {
        maybeCreate();
        setOpen(false);
      }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      // Tab moves on to the next field (the list is not in the Tab order).
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={className}>
      <Input
        ref={inputRef}
        dir={isAr ? 'rtl' : 'ltr'}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={current}
        onChange={(e) => setTyped(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={maybeCreate}
      />
      {open && filtered.length > 0 && (
        <AnchoredLayer
          anchorRef={inputRef}
          layerRef={layerRef}
          width="anchor"
          maxHeight={LIST_MAX_HEIGHT}
          className="border border-border bg-popover py-1 text-body shadow-card"
        >
          <SectionComboboxOptions
            options={filtered}
            listId={listId}
            active={active}
            isAr={isAr}
            onPick={pick}
            onHover={setActive}
          />
        </AnchoredLayer>
      )}
    </div>
  );
}
