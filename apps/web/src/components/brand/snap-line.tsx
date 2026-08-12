'use client';

import type { CSSProperties } from 'react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * The signature snapped line: a 2px chalk rule with endpoint dots that draws
 * across via scaleX with the taut-string overshoot. Reduced-motion -> static
 * full width. Chalk is rare — use as a single header/section motif.
 */
export function SnapLine({
  className,
  animate = true,
  delay = 0,
}: {
  className?: string;
  animate?: boolean;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const draw = animate && !reduced;
  const style: CSSProperties | undefined = draw
    ? { animationDelay: `${delay}ms` }
    : undefined;

  return (
    <div
      className={cn('relative h-0.5 w-full bg-primary', draw && 'snap-draw', className)}
      style={style}
    >
      <span
        aria-hidden
        className="absolute top-1/2 size-[5px] -translate-y-1/2 rounded-full bg-primary"
        style={{ insetInlineStart: 0 }}
      />
      <span
        aria-hidden
        className="absolute top-1/2 size-[5px] -translate-y-1/2 rounded-full bg-primary"
        style={{ insetInlineEnd: 0 }}
      />
    </div>
  );
}
