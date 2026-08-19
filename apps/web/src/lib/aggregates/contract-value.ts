// PURE contract-value aggregates. All money is scale-4 (NUMERIC(18,4)) carried as
// strings; arithmetic reuses the proposal-totals BigInt engine so there is NO
// float drift. No server-only imports.
//
// The REVISED contract value is a COMPUTED aggregate (originalValue + Σ approved
// VO netDeltas) — deliberately never stored on the contract row (OWNER decision
// A3), so it can never collide with the MT100 immutability lock.
import {
  formatMoney4,
  parseMoney4,
  type LineTotals,
} from './proposal-totals';

/**
 * The signed net delta of a variation order = Σ of its line totals. A de-scope
 * line (negative qty -> negative lineTotal) reduces the delta, so the result may
 * be NEGATIVE. The per-line totals are computed by the proposal-totals engine
 * (computeLine) and passed in here; this only sums them.
 */
export function computeVariationNetDelta(lines: LineTotals[]): string {
  let delta = 0n;
  for (const l of lines) delta += parseMoney4(l.lineTotal);
  return formatMoney4(delta);
}

/**
 * Revised contract value = originalValue + Σ approved-VO netDeltas. Only pass the
 * deltas of VOs whose status is `approved`; a rejected/issued/draft VO must not
 * move the contract value.
 */
export function computeRevisedContractValue(
  originalValue: string,
  approvedDeltas: string[],
): string {
  let total = parseMoney4(originalValue);
  for (const d of approvedDeltas) total += parseMoney4(d);
  return formatMoney4(total);
}
