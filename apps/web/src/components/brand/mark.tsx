import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export interface MarkProps {
  /** Rendered px (width=height). Below 24 the string+endpoints drop to the V. */
  size?: number;
  variant?: 'full' | 'icon' | 'mono';
  /** Line-draw the strokes (stroke-dashoffset). Reduced-motion -> composed. */
  animate?: boolean;
  className?: string;
}

/**
 * The Metra mark (Snap Line): a filled CHALK square with the white "pinch" —
 * taut string + the shallow V (pinch point / M-stroke / small-size check) and
 * two endpoint dots. Geometry is the identity SVG (viewBox 58, stroke 2.4, r3.2).
 * NEVER outline / gradient / rounded — a stamped field, not a floating icon.
 */
export function Mark({ size = 32, variant = 'full', animate = false, className }: MarkProps) {
  const iconOnly = variant === 'icon' || size < 24;
  const mono = variant === 'mono';
  const field = mono ? 'currentColor' : 'hsl(var(--primary))';
  const ink = mono ? 'hsl(var(--background))' : 'hsl(var(--primary-foreground))';

  const drawStyle: CSSProperties | undefined = animate
    ? ({
        strokeDasharray: 1,
        animation: 'draw var(--dur-3) var(--ease-out) forwards',
        ['--draw-len']: 1,
      } as CSSProperties)
    : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 58 58"
      fill="none"
      aria-hidden
      className={cn('block', className)}
    >
      <rect width="58" height="58" fill={field} />
      {iconOnly ? (
        // The V alone, thicker — no string, no endpoints (below 24px / app icon).
        <path
          d="M13 24l16 13 16-13"
          stroke={ink}
          strokeWidth={5}
          strokeLinejoin="round"
          fill="none"
          pathLength={1}
          style={drawStyle}
        />
      ) : (
        <>
          <path d="M11 22h36" stroke={ink} strokeWidth={2.4} pathLength={1} style={drawStyle} />
          <path
            d="M11 22l18 15 18-15"
            stroke={ink}
            strokeWidth={2.4}
            strokeLinejoin="round"
            fill="none"
            pathLength={1}
            style={drawStyle}
          />
          <circle cx="11" cy="22" r="3.2" fill={ink} />
          <circle cx="47" cy="22" r="3.2" fill={ink} />
        </>
      )}
    </svg>
  );
}
