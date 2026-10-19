// The changes a market row shows, computed from its effective series and never
// read from the bulletin's printed % column. Pure and client-safe. The figure is
// the gate's own (percentChange, @metra/db/market-percent), so the owner's
// review.html and a studio's screen print the same change for the same months.
import { percentChange } from '@metra/db/market-percent';
import type { MarketChanges, MarketPoint } from './types';

const NO_CHANGES: MarketChanges = { momPct: null, ytdPct: null, yoyPct: null };

/** 'YYYY-MM' moved by `months` calendar months (negative goes back). */
export function shiftMonth(month: string, months: number): string {
  const [year, monthOfYear] = month.split('-').map(Number);
  const index = year * 12 + (monthOfYear - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The price of `month` in `series`, or null when the month is missing or suspended. Never a neighbour's. */
function pricedIn(series: readonly MarketPoint[], month: string): string | null {
  const point = series.find((candidate) => candidate.month === month);
  return point?.status === 'priced' ? point.price : null;
}

/**
 * The newest month against the calendar month before it (MoM), January of its
 * year (YTD; none in January itself) and the same month a year earlier (YoY).
 * A gap is never skipped: a missing or suspended comparison month is null, and
 * so is every change of a suspended newest month.
 */
export function marketChanges(series: readonly MarketPoint[]): MarketChanges {
  const latest = series.at(-1);
  if (!latest || latest.status !== 'priced') return NO_CHANGES;
  const january = `${latest.month.slice(0, 4)}-01`;
  return {
    momPct: percentChange(pricedIn(series, shiftMonth(latest.month, -1)), latest.price),
    ytdPct: latest.month === january ? null : percentChange(pricedIn(series, january), latest.price),
    yoyPct: percentChange(pricedIn(series, shiftMonth(latest.month, -12)), latest.price),
  };
}
