// The dashboard charts' SHAPING — gap filling, columns, and the sums the donuts
// render. PURE and CLIENT-SAFE: arithmetic over plain data, with the month LABEL
// injected by the caller so this module needs no locale and no Intl.
//
// It lived inline in `dashboard/page.tsx`, which is how that file reached 255
// lines and why the only falsifiable part of the dashboard had no test (R3:
// arithmetic in a UI file). A page composes; it does not compute.
import { fillMonths, type MonthlyBucket, type RangeMonths } from './range';
import type { ClientsMonth, ProjectsMonth } from './queries';

/** One bar: its month, its rendered label, and the segments that stack in it. */
export interface ChartColumn {
  month: string;
  label: string;
  segments: Array<{ key: string; value: number }>;
}

/** One donut slice. */
export interface ChartSlice {
  key: string;
  value: number;
}

/** `YYYY-MM` to whatever the caller wants a reader to see. */
export type MonthLabel = (month: string) => string;

/**
 * Buckets to columns, with EVERY month in the window present.
 *
 * Postgres only returns months that HAVE rows, so a quiet March would simply be
 * absent and the chart would draw February straight into April as though the gap
 * never happened. `fillMonths` is what makes the series honest; this wraps it
 * with the per-series segment shape.
 */
function toColumns<T extends MonthlyBucket>(
  rows: readonly T[],
  months: RangeMonths,
  empty: (month: string) => T,
  label: MonthLabel,
  segments: (bucket: T) => Array<{ key: string; value: number }>,
): ChartColumn[] {
  return fillMonths(rows, months, empty).map((bucket) => ({
    month: bucket.month,
    label: label(bucket.month),
    segments: segments(bucket),
  }));
}

/** The projects series: active / completed / other, per month. */
export function projectColumns(
  rows: readonly ProjectsMonth[],
  months: RangeMonths,
  label: MonthLabel,
): ChartColumn[] {
  return toColumns(
    rows,
    months,
    (month) => ({ month, active: 0, completed: 0, other: 0 }),
    label,
    (bucket) => [
      { key: 'active', value: bucket.active },
      { key: 'completed', value: bucket.completed },
      { key: 'other', value: bucket.other },
    ],
  );
}

/** The clients series: active / inactive, per month. */
export function clientColumns(
  rows: readonly ClientsMonth[],
  months: RangeMonths,
  label: MonthLabel,
): ChartColumn[] {
  return toColumns(
    rows,
    months,
    (month) => ({ month, active: 0, inactive: 0 }),
    label,
    (bucket) => [
      { key: 'active', value: bucket.active },
      { key: 'inactive', value: bucket.inactive },
    ],
  );
}

/**
 * The donut slices for a series: each key's total OVER THE SAME WINDOW the bars
 * covered.
 *
 * Summing the monthly buckets is what keeps the range filter meaningful and
 * needs no new query — the donut answers "what is the split" over exactly the
 * period the bars used to trend across. The month-by-month shape is what the
 * form gives up. A key with no segment anywhere sums to 0 rather than vanishing,
 * so the legend and the arithmetic cannot disagree.
 */
export function sliceTotals(
  columns: readonly ChartColumn[],
  keys: readonly string[],
): ChartSlice[] {
  return keys.map((key) => ({
    key,
    value: columns.reduce(
      (total, column) =>
        total + (column.segments.find((segment) => segment.key === key)?.value ?? 0),
      0,
    ),
  }));
}
