import { ArrowRight, Check, Hourglass, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/lib/ui/status-tone';
import { cn } from '@/lib/utils';

// NOT 'use client', no hooks: a presentational primitive that renders in server
// and client trees alike. The status LOGIC lives in lib (a resolver picks the
// tone, the caller translates the label); this only paints it.

const TONE_CLASS: Record<StatusTone, string> = {
  yourMove: 'border border-[color:var(--brand-tint-border)] bg-brand-tint text-brand-ink',
  waiting: 'bg-[color:var(--track)] text-[color:var(--text-muted)]',
  stalled: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  done: 'bg-[color:var(--success-tint)] text-[color:var(--success)]',
  draft: 'border border-dashed border-[color:var(--field-border)] text-[color:var(--text-muted)]',
  neutral: 'bg-[color:var(--track)] text-[color:var(--text-muted)]',
};

const TONE_ICON: Record<StatusTone, LucideIcon | null> = {
  yourMove: ArrowRight,
  waiting: Hourglass,
  stalled: TriangleAlert,
  done: Check,
  draft: null,
  neutral: null,
};

export interface StatusChipProps {
  tone: StatusTone;
  label: string;
  /** A short qualifier after a middot, e.g. how many days it has waited. */
  detail?: string;
  className?: string;
}

export function StatusChip({ tone, label, detail, className }: StatusChipProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-0.5 text-caption font-semibold',
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn('size-3 shrink-0', tone === 'yourMove' && 'rtl:-scale-x-100')}
          aria-hidden
        />
      )}
      {label}
      {detail && (
        <>
          <span aria-hidden>·</span>
          {detail}
        </>
      )}
    </span>
  );
}
