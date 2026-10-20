import { SPARKLINE } from './market-row-view';
import type { SparklineGeometry } from './sparkline-geometry';

/** The last 12 months at a glance. Time runs left to right in BOTH locales (svg coordinates never mirror), like the figures beside it. */
export function MarketSparkline({ trend, label }: { trend: SparklineGeometry; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${SPARKLINE.width} ${SPARKLINE.height}`}
      width={SPARKLINE.width}
      height={SPARKLINE.height}
      className="overflow-visible text-brand"
    >
      {trend.lines.map((points) => (
        <polyline key={points} points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {trend.dots.map((dot) => (
        <circle key={`${dot.x},${dot.y}`} cx={dot.x} cy={dot.y} r={1.75} fill="currentColor" />
      ))}
    </svg>
  );
}
