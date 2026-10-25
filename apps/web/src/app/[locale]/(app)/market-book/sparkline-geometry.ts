// The sparkline's shape: one polyline per run of consecutive priced months, and
// a dot for a priced month standing alone. A missing or suspended month breaks
// the line, so a gap is never drawn as a trend. Pure; x grows with time in BOTH
// locales (the svg is drawn left to right, like the figures).
//
// x is the month's place on a FIXED axis, the row's window (the newest
// bulletin's month and the 12 before it), the same for every row: two rows
// compare in time, and an item priced only in the last two months draws only
// at the right end, never stretched across the width.
import { MARKET_WINDOW_MONTHS } from '@/lib/market-book/change';
import type { MarketPoint } from '@/lib/market-book/types';

export interface SparklineGeometry {
  /** Each an svg `points` attribute ("x,y x,y"). */
  lines: string[];
  dots: Array<{ x: number; y: number }>;
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
const round = (value: number) => Math.round(value * 10) / 10;

/** `windowEnd` is the newest bulletin's month ('YYYY-MM'); a month outside the window is not drawn. */
export function sparklineGeometry(series: readonly MarketPoint[], windowEnd: string, width: number, height: number, inset = 2): SparklineGeometry {
  const first = monthIndex(windowEnd) - MARKET_WINDOW_MONTHS;
  const inWindow = (point: MarketPoint) => monthIndex(point.month) >= first && monthIndex(point.month) <= first + MARKET_WINDOW_MONTHS;
  const priced = series.filter((point) => point.status === 'priced' && point.price !== null && inWindow(point));
  if (priced.length === 0) return { lines: [], dots: [] };
  const values = priced.map((point) => Number(point.price));
  const low = Math.min(...values);
  const range = Math.max(...values) - low;
  const at = (point: MarketPoint) => ({
    x: round(inset + ((monthIndex(point.month) - first) / MARKET_WINDOW_MONTHS) * (width - 2 * inset)),
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
