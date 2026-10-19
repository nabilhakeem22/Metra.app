// The sparkline's shape: one polyline per run of consecutive priced months, and
// a dot for a priced month standing alone. A missing or suspended month breaks
// the line, so a gap is never drawn as a trend. Pure; x grows with time in BOTH
// locales (the svg is drawn left to right, like the figures).
import type { MarketPoint } from '@/lib/market-book/types';

export interface SparklineGeometry {
  /** Each an svg `points` attribute ("x,y x,y"). */
  lines: string[];
  dots: Array<{ x: number; y: number }>;
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
const round = (value: number) => Math.round(value * 10) / 10;

export function sparklineGeometry(series: readonly MarketPoint[], width: number, height: number, inset = 2): SparklineGeometry {
  const priced = series.filter((point) => point.status === 'priced' && point.price !== null);
  if (priced.length === 0) return { lines: [], dots: [] };
  const first = monthIndex(series[0].month);
  const span = Math.max(monthIndex(series[series.length - 1].month) - first, 1);
  const values = priced.map((point) => Number(point.price));
  const low = Math.min(...values);
  const range = Math.max(...values) - low;
  const at = (point: MarketPoint) => ({
    x: round(inset + ((monthIndex(point.month) - first) / span) * (width - 2 * inset)),
    y: round(range === 0 ? height / 2 : height - inset - ((Number(point.price) - low) / range) * (height - 2 * inset)),
  });

  const runs: MarketPoint[][] = [];
  for (const point of priced) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous && monthIndex(point.month) - monthIndex(previous.month) === 1) run.push(point);
    else runs.push([point]);
  }
  return {
    lines: runs.filter((run) => run.length > 1).map((run) => run.map(at).map(({ x, y }) => `${x},${y}`).join(' ')),
    dots: runs.filter((run) => run.length === 1).map((run) => at(run[0])),
  };
}
