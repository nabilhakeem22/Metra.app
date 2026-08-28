'use client';

import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Required group label (the control is a set of icon-free toggle buttons). */
  ariaLabel: string;
  className?: string;
}

// Reusable segmented control: pill track (--track, 3px pad) with a sliding
// active thumb (--glass-strong — a FLAT opaque fill, no backdrop-filter, so it
// never nests blur), 13px/700 active vs 500 inactive. Controllable via
// value / onValueChange.
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-[2px] rounded-full p-[3px]', className)}
      style={{ background: 'var(--track)' }}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'rounded-full px-[14px] py-[6px] text-[13px] outline-none focus-ring-brand transition-colors motion-reduce:transition-none',
              isActive
                ? 'font-bold text-[color:var(--text)]'
                : 'font-medium text-[color:var(--text-muted)]',
            )}
            style={
              isActive
                ? {
                    background: 'var(--glass-strong)',
                    boxShadow: '0 1px 3px rgba(58,46,28,.14)',
                  }
                : undefined
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
