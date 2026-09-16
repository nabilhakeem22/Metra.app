// The PURE half of a variation draft save: what the studio typed, turned into
// rows the database can hold, or a coded refusal. No db, no `server-only` — so
// the money rules standing between a pasted string and a numeric(18,4) column
// can be exercised without a database.
//
// A VO line may be a NEGATIVE de-scope (negative qty), so every total downstream
// of one may be negative too. That is the whole reason this module cannot borrow
// the proposal's line validator.
import type { ActionCode } from '@/lib/actions/result';
import { computeVariationNetDelta } from '@/lib/aggregates/contract-value';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import { readMoney, withinMagnitude } from '@/lib/money/read';
import { MAX_TOTAL_LINES } from '@/lib/lines/limits';
import { isPercentInRange } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import { SIGNED_MONEY_FIELD } from '../validation';
import type { PreparedVariationLine, VariationLineInput } from './types';

export type ValidatedVariationLines =
  | { ok: true; lines: PreparedVariationLine[]; netDelta: string }
  | { ok: false; error: ActionCode };

/** The four figures a line is priced from, each already read and in range. */
interface LineFactors {
  qty: string;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}

/** What `computeLine` gives back, before it is checked against the column cap. */
interface LineTotals {
  lineCost: string;
  lineTotal: string;
  lineMargin: string;
}

/**
 * Read the four priced factors, or say why not.
 *
 * Past the cap is its own answer: a bare `invalid` on a variation line whose
 * quantity is 1e13 tells the studio nothing it can act on — it can see perfectly
 * well that the cell IS a number.
 */
function validateLineFactors(line: VariationLineInput): LineFactors | ActionCode {
  const qty = readMoney(line.qty, SIGNED_MONEY_FIELD);
  const unitCost = readMoney(line.unitCost, { blank: '0' });
  const unitPrice = readMoney(line.unitPrice, { blank: '0' });
  const discountPct = readMoney(line.discountPct, { blank: '0' });
  const factors = [qty, unitCost, unitPrice, discountPct];
  if (factors.some((factor) => !factor.ok)) {
    const tooLarge = factors.some((f) => !f.ok && f.reason === 'too_large');
    return tooLarge ? 'amount_too_large' : 'invalid';
  }
  if (!qty.ok || !unitCost.ok || !unitPrice.ok || !discountPct.ok) return 'invalid';
  if (!isPercentInRange(discountPct.value)) return 'discount_out_of_range';
  return {
    qty: qty.value,
    unitCost: unitCost.value,
    unitPrice: unitPrice.value,
    discountPct: discountPct.value,
  };
}

/**
 * Recompute the line's money from the engine and check it against the column.
 *
 * The FACTORS were each inside the cap; their PRODUCT need not be. A line total
 * past the cap overflows numeric(18,4) at the database — and so does a line cost
 * or margin, which are persisted on the same row. A signed qty makes the margin
 * the widest of the three, so none of them is implied by the others.
 */
function computeLineTotals(factors: LineFactors): LineTotals | ActionCode {
  const totals = computeLine(factors);
  const overflows =
    !withinMagnitude(totals.lineTotal) ||
    !withinMagnitude(totals.lineCost) ||
    !withinMagnitude(totals.lineMargin);
  return overflows ? 'amount_too_large' : totals;
}

/**
 * Validate and recompute ONE line. The client's totals are ignored entirely —
 * every figure on the returned row comes from the money engine (Money law).
 * `sortOrder` falls back to the line's position, so a client that omits it still
 * gets a stable order.
 */
function validateVariationLine(
  line: VariationLineInput,
  index: number,
): PreparedVariationLine | ActionCode {
  const descriptionAr = clean(line.descriptionAr);
  const descriptionEn = clean(line.descriptionEn);
  if (!descriptionAr && !descriptionEn) return 'line_required';

  const factors = validateLineFactors(line);
  if (typeof factors === 'string') return factors;
  if (!line.unit) return 'invalid';

  const totals = computeLineTotals(factors);
  if (typeof totals === 'string') return totals;

  return {
    contractLineId: line.contractLineId?.trim() || null,
    costItemId: line.costItemId?.trim() || null,
    descriptionAr,
    descriptionEn,
    unit: line.unit,
    sortOrder: line.sortOrder ?? index,
    ...factors,
    ...totals,
  };
}

/**
 * Validate every line and compute the VO's net delta, BEFORE the transaction
 * opens. Nothing persists on a bad input, and the FIRST bad line decides the
 * whole call — a partially-saved variation is not a state this product has.
 *
 * netDelta = Sigma lineTotal and may be negative (a pure de-scope). The SUM of
 * lines each inside the cap need not itself be inside it, which is why the last
 * magnitude check is not implied by the per-line ones.
 */
export function validateVariationLines(
  lines: VariationLineInput[],
): ValidatedVariationLines {
  if (lines.length > MAX_TOTAL_LINES) return { ok: false, error: 'too_many_lines' };

  const prepared: PreparedVariationLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const validated = validateVariationLine(lines[index], index);
    if (typeof validated === 'string') return { ok: false, error: validated };
    prepared.push(validated);
  }

  const netDelta = computeVariationNetDelta(prepared);
  if (!withinMagnitude(netDelta)) return { ok: false, error: 'amount_too_large' };
  return { ok: true, lines: prepared, netDelta };
}
