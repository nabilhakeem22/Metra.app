'use client';

import { cn } from '@/lib/utils';

/**
 * One row of the price-book listbox. The combobox input keeps focus (mouse
 * down is cancelled), and the row picks on CLICK, so a finger that starts a
 * scroll on a tablet picks nothing.
 */
export function PriceBookPickerOption({
  id,
  name,
  code,
  active,
  onPick,
  onHover,
}: {
  id: string;
  name: string;
  code: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <li id={id} role="option" aria-selected={active}>
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          'flex w-full items-baseline justify-between gap-3 px-2 py-1.5 text-start',
          active ? 'bg-muted text-foreground' : 'text-popover-foreground',
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPick}
        onMouseEnter={onHover}
      >
        <span>{name}</span>
        <span className="shrink-0 text-caption text-muted-foreground" dir="ltr">{code}</span>
      </button>
    </li>
  );
}
