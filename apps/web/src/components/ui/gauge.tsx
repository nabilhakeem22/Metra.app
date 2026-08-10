import { cn } from '@/lib/utils';

export interface GaugeProps {
  value?: number | null;
  /** Optional multi-segment breakdown (reserved; single arc used in P0). */
  segments?: { value: number; className?: string }[];
  centerLabel?: string;
  empty?: boolean;
  emptyLabel?: string;
  className?: string;
}

// Semicircle arc: radius 80, centred at (100,100), drawn left->right along the top.
const ARC_PATH = 'M20 100 A80 80 0 0 1 180 100';
const ARC_LENGTH = Math.PI * 80; // ~251.33

export function Gauge({
  value,
  centerLabel,
  empty,
  emptyLabel,
  className,
}: GaugeProps) {
  const isEmpty = empty || value == null;
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const filled = (clamped / 100) * ARC_LENGTH;

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <svg
        viewBox="0 0 200 110"
        className="w-full max-w-[220px]"
        role="img"
        aria-label={centerLabel ?? emptyLabel}
      >
        {/* Track */}
        <path
          d={ARC_PATH}
          fill="none"
          strokeWidth={14}
          strokeLinecap="round"
          className="stroke-muted"
        />

        {/* Value arc — RTL: mirror ONLY this group in place so it fills from the
            inline-start. Legend/number text below stays un-mirrored. */}
        {!isEmpty && (
          <g className="origin-center [transform-box:view-box] rtl:-scale-x-100">
            <path
              d={ARC_PATH}
              fill="none"
              strokeWidth={14}
              strokeLinecap="round"
              className="stroke-[hsl(var(--primary))]"
              strokeDasharray={`${filled} ${ARC_LENGTH}`}
            />
          </g>
        )}

        {/* Center number (Western numerals) — omitted when empty */}
        {!isEmpty && (
          <text
            x="100"
            y="92"
            textAnchor="middle"
            className="fill-foreground text-2xl font-bold"
          >
            {Math.round(clamped)}%
          </text>
        )}
      </svg>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        centerLabel && (
          <p className="text-sm font-medium text-muted-foreground">
            {centerLabel}
          </p>
        )
      )}
    </div>
  );
}
