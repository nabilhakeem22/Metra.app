'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SectionOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

/**
 * Section-title combobox (create-on-use). A single localized text field over a
 * lightweight popover of saved titles (no cmdk, no Radix Popover — one-new-dep
 * budget spent on the tooltip). Picking an option fills BOTH title fields;
 * typing a brand-new name keeps it on the section and fire-and-forgets onCreate
 * so it joins the library. Filtering matches either language. Logical CSS only.
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
  const listId = useMemo(
    () => `sec-cb-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  const label = (o: SectionOption) =>
    (isAr ? o.nameAr || o.nameEn : o.nameEn || o.nameAr) ?? '';

  const filtered = useMemo(() => {
    const q = current.trim().toLowerCase();
    const list = q
      ? options.filter(
          (o) =>
            (o.nameEn ?? '').toLowerCase().includes(q) ||
            (o.nameAr ?? '').toLowerCase().includes(q),
        )
      : options;
    return list.slice(0, 8);
  }, [options, current]);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

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
    const exists = options.some((o) =>
      (isAr ? o.nameAr : o.nameEn)?.trim().toLowerCase() === name.toLowerCase(),
    );
    if (!exists) {
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
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Input
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
        <ul
          id={listId}
          role="listbox"
          className="absolute start-0 z-20 mt-1 max-h-56 w-full overflow-auto border border-border bg-popover py-1 text-sm shadow-card"
        >
          {filtered.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                dir={isAr ? 'rtl' : 'ltr'}
                className={cn(
                  'flex w-full items-center px-2.5 py-1.5 text-start transition-colors',
                  i === active ? 'bg-muted text-foreground' : 'text-popover-foreground',
                )}
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {label(o)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
