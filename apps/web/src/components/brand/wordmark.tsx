'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface WordmarkProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
};

const MARK_SIZE: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-7',
};

/**
 * The Metra mark: a ledger baseline rule with an ascending trace ending in a
 * node — the quote->invoice "trace" signature. Single consistent copper stroke.
 */
function TraceMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('text-brand', className)}
    >
      {/* baseline rule */}
      <line x1="3" y1="19" x2="21" y2="19" strokeOpacity={0.55} />
      {/* ascending trace */}
      <path d="M5 19 L10 12 L14 15 L19 7" />
      {/* node (invoice endpoint) */}
      <circle cx="19" cy="7" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Wordmark({ className, size = 'md' }: WordmarkProps) {
  const t = useTranslations('app');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-bold tracking-tight text-foreground',
        SIZE[size],
        className,
      )}
    >
      <TraceMark className={MARK_SIZE[size]} />
      {t('name')}
    </span>
  );
}
