'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface WordmarkProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

// Mark side / Latin label / Arabic label, in px. `md` is the shell default and
// matches the design spec (24px squircle, 19/18px label).
const SCALE: Record<
  NonNullable<WordmarkProps['size']>,
  { mark: number; latin: number; arabic: number }
> = {
  sm: { mark: 20, latin: 17, arabic: 16 },
  md: { mark: 24, latin: 19, arabic: 18 },
  lg: { mark: 32, latin: 27, arabic: 26 },
};

// The stepped "ledger" rule inside the mark ascends toward the reading edge, so
// it must mirror with direction. LTR climbs to the trailing (right) side; RTL is
// its exact mirror across the 32-viewBox centre (x -> 32 - x). Both strings come
// verbatim from the design reference (options 2a / 2b).
const STEP_PATH_LTR = 'M9 21.5 L14 21.5 L14 15.5 L19 15.5 L19 10 L23 10';
const STEP_PATH_RTL = 'M23 21.5 L18 21.5 L18 15.5 L13 15.5 L13 10 L9 10';

/**
 * The Metra mark: a 24px squircle with a vertical blue gradient fill (theme
 * tokens), a white hairline stroke, and a stepped ledger path that mirrors in
 * RTL. Followed by the wordmark "Metra" / "ميترا".
 */
export function Wordmark({ className, size = 'md' }: WordmarkProps) {
  const t = useTranslations('app');
  const locale = useLocale();
  const isRtl = locale === 'ar-EG';
  const scale = SCALE[size];
  // Unique per instance so the sidebar and drawer wordmarks don't share (and
  // collide on) a single gradient id.
  const gradientId = useId();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[9px] font-bold text-[color:var(--text)]',
        className,
      )}
    >
      <svg
        width={scale.mark}
        height={scale.mark}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect
          x={1.2}
          y={1.2}
          width={29.6}
          height={29.6}
          rx={9.6}
          fill={`url(#${gradientId})`}
          stroke="rgba(255,255,255,.30)"
        />
        <path
          d={isRtl ? STEP_PATH_RTL : STEP_PATH_LTR}
          stroke="hsl(var(--primary-foreground))"
          strokeWidth={2.2}
          strokeLinecap="round"
          fill="none"
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--brand-hi)" />
            <stop offset="1" stopColor="hsl(var(--brand))" />
          </linearGradient>
        </defs>
      </svg>
      <span
        style={{
          fontSize: `${isRtl ? scale.arabic : scale.latin}px`,
          // Tajawal never gets negative tracking; Latin display tightens.
          letterSpacing: isRtl ? '0' : '-0.04em',
        }}
      >
        {t('name')}
      </span>
    </span>
  );
}
