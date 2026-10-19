import type { MarketPoint } from '@/lib/market-book/types';
import { sparklineGeometry } from './sparkline-geometry';

const WIDTH = 96;
const HEIGHT = 24;

/** The last 12 months at a glance. Time runs left to right in BOTH locales (svg coordinates never mirror), like the figures beside it. */
export function MarketSparkline({ series, label }: { series: readonly MarketPoint[]; label: string }) {
  const { lines, dots } = sparklineGeometry(series, WIDTH, HEIGHT);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="overflow-visible text-brand"
    >
      {lines.map((points) => (
        <polyline key={points} points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {dots.map((dot) => (
        <circle key={`${dot.x},${dot.y}`} cx={dot.x} cy={dot.y} r={1.75} fill="currentColor" />
      ))}
    </svg>
  );
}
