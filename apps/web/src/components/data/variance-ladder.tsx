'use client';

import type { CSSProperties } from 'react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';

export interface LadderRow {
  name: string;
  /** What it actually costs (the fill). */
  actual: number;
  /** What was contracted / quoted (the datum). */
  contracted: number;
  /** % of work executed — the datum sits here, not at 100%. */
  executedPct?: number;
  /** Actual past contracted (a loss / overrun). */
  over?: boolean;
}

export interface VarianceLadderProps {
  /** null / [] -> honest empty state. NEVER a demo row. */
  rows: LadderRow[] | null;
  emptyLabel: string;
  /** Preformatted `actual / contracted` display per row (Western numerals). */
  formatPair?: (row: LadderRow) => string;
  animate?: boolean;
  className?: string;
}

function pct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function VarianceLadder({
  rows,
  emptyLabel,
  formatPair,
  animate = true,
  className,
}: VarianceLadderProps) {
  const reduced = useReducedMotion();

  if (!rows || rows.length === 0) {
    return (
      <div
        className={cn(
          'flex min-h-24 items-center justify-center border border-dashed p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  const grow: CSSProperties | undefined =
    animate && !reduced
      ? { animation: 'ladder-grow var(--dur-3) var(--ease-out) both' }
      : undefined;

  return (
    <div className={cn('space-y-4', className)}>
      {rows.map((row, i) => {
        const over = row.over ?? row.actual > row.contracted;
        // Over: scale the track to `actual`; the datum (contracted) falls short of
        // the end and everything past it spills red. Otherwise scale to contracted.
        const fillW = over
          ? pct((row.contracted / row.actual) * 100)
          : pct((row.actual / row.contracted) * 100);
        const spillW = over ? 100 - fillW : 0;
        const datumW = over
          ? fillW
          : pct(row.executedPct ?? 100);
        const delay: CSSProperties = { animationDelay: `calc(${i} * 60ms)` };

        return (
          <div key={`${row.name}-${i}`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{row.name}</span>
              {formatPair && (
                <span className={cn('num text-xs', over && 'text-spill')}>
                  {formatPair(row)}
                </span>
              )}
            </div>
            <div className="relative h-5 bg-track">
              <div
                className={cn(
                  'ladder-fill absolute inset-y-0 start-0',
                  over ? 'bg-fill' : 'bg-fill-ok',
                )}
                style={{ width: `${fillW}%`, ...grow, ...delay }}
              />
              {spillW > 0 && (
                <div
                  className="ladder-fill absolute inset-y-0 bg-spill"
                  style={{ insetInlineStart: `${fillW}%`, width: `${spillW}%`, ...grow, ...delay }}
                />
              )}
              <div
                aria-hidden
                className="absolute w-0.5 bg-datum"
                style={{ insetInlineStart: `${datumW}%`, insetBlock: '-4px' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
