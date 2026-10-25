'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One row of a custom combobox's listbox (the section-title suggestions, the
 * price-book picker). The combobox input keeps focus: the row is out of the Tab
 * order and its mouse down is cancelled, so the arrows keep moving the active
 * row from the input and a press never blurs it. It picks on CLICK, so a finger
 * that starts a scroll on a tablet picks nothing.
 */
export function ListboxOption({
  id,
  active,
  onPick,
  onHover,
  dir,
  className,
  children,
}: {
  id?: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  dir?: 'rtl' | 'ltr';
  /** The row's own layout (alignment, gap, padding); the active tone is shared. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <li id={id} role="option" aria-selected={active}>
      <button
        type="button"
        tabIndex={-1}
        dir={dir}
        className={cn(
          'flex w-full px-2.5 py-1.5 text-start transition-colors',
          active ? 'bg-muted text-foreground' : 'text-popover-foreground',
          className,
        )}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPick}
        onMouseEnter={onHover}
      >
        {children}
      </button>
    </li>
  );
}
