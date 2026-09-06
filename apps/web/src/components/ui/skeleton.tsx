import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * A loading placeholder block.
 *
 * Per the design handoff: a --track-filled block at the panel's radius with a
 * 1.4s shimmer sweep, not a pulsing opacity. `relative` + `overflow-hidden` are
 * load-bearing — the shimmer is an ::after that sweeps across the block and has
 * to be clipped to it. Under reduced motion the sweep is removed entirely and
 * the block rests as a flat fill, which still reads as "content pending".
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'metra-shimmer relative overflow-hidden rounded-item',
        className,
      )}
      style={{ background: 'var(--track)' }}
      {...props}
    />
  );
}
