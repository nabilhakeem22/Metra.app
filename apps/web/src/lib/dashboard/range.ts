// The dashboard's date filter and month-bucket gap filling — PURE and CLIENT-SAFE:
// no db import, no `server-only`, no 'use client'. Shared by the server page (which
// queries) and the filter control (which renders), so the two cannot disagree about
// what a valid range is.

/** The windows the filter offers. Months, because a fit-out project runs in months
 *  and a week-level dashboard would be mostly empty bars. */
export const RANGE_OPTIONS = [3, 6, 12] as const;

export type RangeMonths = (typeof RANGE_OPTIONS)[number];

export const DEFAULT_RANGE: RangeMonths = 6;

/** Parse the `range` search param. Anything unrecognised falls back to the default
 *  rather than erroring — a hand-edited URL must not break the dashboard. */
export function parseRange(value: string | string[] | undefined): RangeMonths {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return (RANGE_OPTIONS as readonly number[]).includes(n)
    ? (n as RangeMonths)
    : DEFAULT_RANGE;
}

/** Every bucket carries its month as `YYYY-MM`. */
export interface MonthlyBucket {
  month: string;
}

/** The `YYYY-MM` labels for the window ending with the current month, oldest first. */
export function monthsInRange(months: RangeMonths, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  return out;
}

/**
 * Fill the months the query returned nothing for.
 *
 * Load-bearing for honesty: Postgres only returns months that HAVE rows, so a
 * quiet March would simply be absent and the chart would draw February straight
 * into April as though the gap never happened. Every bucket in the window is
 * present after this, zeroed where there was no data.
 */
export function fillMonths<T extends MonthlyBucket>(
  rows: readonly T[],
  months: RangeMonths,
  empty: (month: string) => T,
  now = new Date(),
): T[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return monthsInRange(months, now).map((m) => byMonth.get(m) ?? empty(m));
}
