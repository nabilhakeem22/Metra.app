'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import {
  WORDMARK_ARABIC,
  WORDMARK_LATIN,
} from '@/components/brand/wordmark-paths';
import { cn } from '@/lib/utils';

/**
 * How the mark meets its ground.
 *
 * `tile` is the mark as specified: a cobalt gradient squircle with white
 * strokes, for any NEUTRAL ground, light or dark.
 *
 * `reverse` is for a BRAND-COLOURED ground, where the tile has nothing to sit
 * against. Measured on the auth panel: the tile's lower stop is #2E6BE6 on a
 * #2E6BE6 panel in light — contrast 1.00, the same colour — and 1.16 against the
 * lighter cobalt in dark. A shape needs about 3:1 to read at all, so the tile was
 * simply invisible and the aperture appeared to float. Reversed, the tile is
 * dropped and the drawing takes `currentColor`, so the lockup inherits
 * `--primary-foreground` and reads as one object with the wordmark beside it.
 */
export type WordmarkTone = 'tile' | 'reverse';

export interface WordmarkProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: WordmarkTone;
  /**
   * Play the Trace draw-on once when this mounts. Reserve it for moments the
   * user actually arrives somewhere — app launch, auth, sidebar mount. Never on
   * persistent chrome, where a redraw on every render reads as a glitch.
   */
  animate?: boolean;
}

// Mark side / wordmark cap-height, in px. `md` is the shell default and matches
// the design spec (24px squircle, 19/18px label).
const SCALE: Record<
  NonNullable<WordmarkProps['size']>,
  { mark: number; latin: number; arabic: number }
> = {
  sm: { mark: 20, latin: 17, arabic: 16 },
  md: { mark: 24, latin: 19, arabic: 18 },
  lg: { mark: 32, latin: 27, arabic: 26 },
};

/**
 * The size ladder from the identity. The mark is NOT one drawing scaled: the
 * stroke thickens and the tile hairline drops away as it shrinks, because a
 * 2.3px stroke that reads as confident at 64px turns to mush at 16.
 *
 * >= 32  gradient tile, 2.3 stroke, hairline. Marketing, splash, auth, header.
 *   24   gradient tile, 2.4 stroke, no hairline. Sidebar, breadcrumbs.
 * <= 16  FLAT fill, 2.6 stroke, no hairline. Favicon, table rows.
 */
function markBuild(px: number): {
  stroke: number;
  hairline: boolean;
  flat: boolean;
} {
  if (px <= 16) return { stroke: 2.6, hairline: false, flat: true };
  if (px < 32) return { stroke: 2.4, hairline: false, flat: false };
  return { stroke: 2.3, hairline: true, flat: false };
}

// Aperture: roofline, walls rising from the same corner, and the window. The
// mark is SYMMETRIC about the 32-viewBox centre, so unlike the stepped-ledger
// mark it replaces there is nothing to mirror in RTL.
const ROOF = 'M5.8 16.2 L16 7.2 L26.2 16.2';
const WALLS = 'M8.9 15.2 V25.2 H23.1 V15.2';

/** The tile + Aperture strokes, at one size. */
export function MetraMark({
  size = 24,
  animate = false,
  tone = 'tile',
  className,
}: {
  size?: number;
  animate?: boolean;
  tone?: WordmarkTone;
  className?: string;
}) {
  // Gradient ids are DOCUMENT-GLOBAL: without a unique id every mark on the
  // page would inherit whichever definition rendered first.
  const gradientId = useId();
  const { stroke, hairline, flat } = markBuild(size);
  const reversed = tone === 'reverse';
  // Reversed, the drawing IS the mark, so it carries the weight the tile used to.
  const ink = reversed ? 'currentColor' : '#FFFFFF';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn('shrink-0', animate && 'metra-trace', className)}
    >
      {/* The logo's gradient is FIXED in both themes — a mark that changes
          colour between light and dark stops reading as one mark. Only the
          hairline is theme-aware (--mark-hairline), because that is about the
          tile's edge against the ground, not about the brand. */}
      {!reversed && (
        <rect
          x={1.2}
          y={1.2}
          width={29.6}
          height={29.6}
          rx={9.6}
          fill={flat ? '#2E6BE6' : `url(#${gradientId})`}
        />
      )}
      {hairline && !reversed && (
        <rect
          x={1.2}
          y={1.2}
          width={29.6}
          height={29.6}
          rx={9.6}
          fill="none"
          stroke="var(--mark-hairline)"
          strokeWidth={1}
        />
      )}
      <g
        stroke={ink}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d={ROOF} data-trace="roof" />
        <path d={WALLS} data-trace="walls" />
      </g>
      <rect
        x={13.6}
        y={17.8}
        width={4.8}
        height={4.8}
        rx={1.3}
        fill={ink}
        data-trace="window"
      />
      {!flat && !reversed && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#5A8DF2" />
            <stop offset="1" stopColor="#2E6BE6" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

/**
 * The full lockup: the Aperture mark followed by the wordmark.
 *
 * The wordmark is drawn as OUTLINES, not text — see wordmark-paths.ts. That
 * keeps the identity's Noto Sans 700 / Noto Sans Arabic 700 exactly, including
 * the -0.025em Latin tracking, without loading two more webfaces for a single
 * word. The lockup carries its own accessible name, since outlines are not text.
 *
 * Gap is 0.35x the mark size, per the identity's clear-space rule.
 */
export function Wordmark({
  className,
  size = 'md',
  animate,
  tone = 'tile',
}: WordmarkProps) {
  const t = useTranslations('app');
  const locale = useLocale();
  const isRtl = locale === 'ar-EG';
  const scale = SCALE[size];
  const glyphs = isRtl ? WORDMARK_ARABIC : WORDMARK_LATIN;

  // The paths are normalised to a 1000-unit em, so the height maps straight
  // from the label size and the width follows the outline's own aspect.
  const [, , vbW, vbH] = glyphs.viewBox.split(' ').map(Number);
  const height = isRtl ? scale.arabic : scale.latin;
  const width = (vbW / vbH) * height;

  return (
    <span
      // The colour lives on the SPAN, not the outline svg, so a caller can
      // override it — the auth panel sets the lockup white over bg-primary.
      // tailwind-merge lets the passed class win over this default.
      className={cn(
        'inline-flex items-center text-[color:var(--text)]',
        className,
      )}
      style={{ gap: `${scale.mark * 0.35}px` }}
      role="img"
      aria-label={t('name')}
    >
      <MetraMark size={scale.mark} animate={animate} tone={tone} />
      <svg
        viewBox={glyphs.viewBox}
        width={width}
        height={height}
        fill="currentColor"
        aria-hidden
        className="shrink-0"
      >
        <path d={glyphs.d} />
      </svg>
    </span>
  );
}
