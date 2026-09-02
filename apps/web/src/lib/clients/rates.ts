// The client's effective advance/retention rates — PURE and CLIENT-SAFE: no db
// import, no `server-only`, no 'use client'. Split from ./financials.ts (which is
// server-only) for exactly the reason the proposals module taught: money math locked
// behind `server-only` cannot be unit-tested, and untested money math is where a
// real rounding bug hid.
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';

export interface ClientEffectiveRates {
  /** Value-weighted advance %, as a scale-4 string, or null when nothing is
   *  committed yet (the cards then say so rather than showing a misleading 0). */
  advancePct: string | null;
  retentionPct: string | null;
  /** How many committed contracts the figures are drawn from — shown as the
   *  provenance line, so the number is never an unexplained percentage. */
  contractCount: number;
}

/**
 * The pure weighting, split out so it is unit-testable without a database — the
 * lesson from the proposals module, where money math locked inside a `server-only`
 * file went untested and hid a real rounding bug.
 */
export function weightedRates(
  rows: Array<{ advancePct: string; retentionPct: string; value: string }>,
): ClientEffectiveRates {
  if (rows.length === 0) {
    return { advancePct: null, retentionPct: null, contractCount: 0 };
  }

  let totalValue = 0n;
  let advanceWeighted = 0n;
  let retentionWeighted = 0n;
  for (const row of rows) {
    const value = parseMoney4(row.value);
    totalValue += value;
    advanceWeighted += parseMoney4(row.advancePct) * value;
    retentionWeighted += parseMoney4(row.retentionPct) * value;
  }

  // Every committed contract is valued at zero (possible before values are set):
  // fall back to a PLAIN mean, so the cards still say something true rather than
  // dividing by zero.
  if (totalValue === 0n) {
    const n = BigInt(rows.length);
    return {
      advancePct: formatMoney4(
        rows.reduce((a, r) => a + parseMoney4(r.advancePct), 0n) / n,
      ),
      retentionPct: formatMoney4(
        rows.reduce((a, r) => a + parseMoney4(r.retentionPct), 0n) / n,
      ),
      contractCount: rows.length,
    };
  }

  return {
    advancePct: formatMoney4(advanceWeighted / totalValue),
    retentionPct: formatMoney4(retentionWeighted / totalValue),
    contractCount: rows.length,
  };
}

