import 'server-only';
// The rescue ledger's time bounds, and the org history every rule reads, as SQL
// pieces of the ONE statement in `queries.ts`.
//
// THE READ IS BOUNDED. No rule reads the studio's whole history: everything
// before `history_start` is out of reach. `history_start` is FIXED, the same for
// every `?range=`: the start of the widest window (12 months) minus a 12 month
// lookback, so at most 24 months are read and a month shows the same figure
// whichever range is picked.
//   - R4 needs the arrival at a gate, which comes before the gate's exit (the
//     outcome, inside the window): up to 12 months of lookback before it.
//   - R3 caps payments by the change orders raised before them; both sides are
//     bounded by the same start, which can only undercount (never overcount)
//     a payment whose change order was raised before it.
//   - R2 counts only alerts at most 60 days before their stage move, and the
//     move is inside the window, so it reads alerts from `alert_start`, 60 days
//     before the SELECTED window: no alert a counted chain can hold is earlier.
//
// The org's transitions and payments are read ONCE (materialized) and every
// rule joins them, because RLS checks membership per row visited.
import { sql, type SQL } from 'drizzle-orm';
import { RANGE_OPTIONS, type RangeMonths } from '../range';
import { rangeStartSql } from '../queries/range-start';

/** How far before the widest window the ledger reads history (months). */
export const HISTORY_LOOKBACK_MONTHS = 12;

/** How long before its stage move a follow up alert still belongs to the chain (days). */
export const ALERT_LOOKBACK_DAYS = 60;

const WIDEST_RANGE = Math.max(...RANGE_OPTIONS) as RangeMonths;

/** window_start and alert_start (the selected range), history_start (fixed). */
export function windowCtes(range: RangeMonths): SQL {
  return sql`
  window_start as (select ${rangeStartSql(range)} as at),
  history_start as (select ${rangeStartSql(WIDEST_RANGE)} - make_interval(months => ${HISTORY_LOOKBACK_MONTHS}) as at),
  alert_start as (select ${rangeStartSql(range)} - make_interval(days => ${ALERT_LOOKBACK_DAYS}) as at)`;
}

/** The org's transitions and payments since history_start, each scanned once. */
export function historyCtes(): SQL {
  return sql`
  org_transitions as materialized (
    select id, engagement_id, trigger, from_state, to_state, decided_at from public.engagement_transitions
     where decided_at >= (select at from history_start)),
  org_payments as materialized (
    select id, engagement_id, kind, amount, cleared_at from public.payment_events
     where cleared_at >= (select at from history_start))`;
}
