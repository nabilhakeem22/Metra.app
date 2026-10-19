import 'server-only';
// THE dashboard window start, in SQL. One declaration for every figure the
// dashboard shows over its `?range=` window: the two trend series and the
// rescue ledger. A window that meant two slightly different things in two
// blocks of one screen would be a bug nobody would spot.
import { sql, type SQL } from 'drizzle-orm';
import type { RangeMonths } from '../range';

/** The first instant of the window: the start of the month `months - 1` months ago, counting the current one. */
export function rangeStartSql(months: RangeMonths): SQL {
  return sql`date_trunc('month', now()) - make_interval(months => ${months - 1})`;
}
