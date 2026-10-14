// The PURE half of a variation draft save: what the studio typed, turned into
// rows the database can hold, or every refusal under the cell it is about. No
// db, no `server-only`, so the money rules standing between a pasted string and
// a numeric(18,4) column can be exercised without a database.
//
// A VO line may be a NEGATIVE de-scope (negative qty), so every total downstream
// of one may be negative too. That is the whole reason this module cannot borrow
// the proposal's line validator.
import { fieldsFailed, type FieldError } from '@/lib/actions/field-errors';
import { err, type ActionResult } from '@/lib/actions/result';
import { computeVariationNetDelta } from '@/lib/aggregates/contract-value';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import { withinMagnitude } from '@/lib/money/read';
import { MAX_TOTAL_LINES } from '@/lib/lines/limits';
import { readMoneyField } from '@/lib/validation/field-rules';
import { isPercentInRange } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import { variationLinePath, type VariationLineColumn } from '../line-fields';
import { SIGNED_MONEY_FIELD } from '../validation';
import type { PreparedVariationLine, VariationLineInput } from './types';

export type ValidatedVariationLines =
  | { ok: true; lines: PreparedVariationLine[]; netDelta: string }
  | { ok: false; refusal: ActionResult };

type LineErrors = Partial<Record<VariationLineColumn, FieldError>>;

/** The four figures a line is priced from, each already read and in range. */
interface LineFactors {
  qty: string;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}

/**
 * Read the four priced factors, or every refusal under its own cell: a figure
 * past the cap says so (the studio can see the cell IS a number), one that is
 * not a number says that, a discount outside 0 to 100 says that.
 */
function readLineFactors(
  line: VariationLineInput,
): { ok: true; factors: LineFactors } | { ok: false; errors: LineErrors } {
  const reads = {
    qty: readMoneyField(line.qty, SIGNED_MONEY_FIELD),
    unitCost: readMoneyField(line.unitCost, { blank: '0' }),
    unitPrice: readMoneyField(line.unitPrice, { blank: '0' }),
    discountPct: readMoneyField(line.discountPct, { blank: '0' }),
  };
  const errors: LineErrors = {};
  for (const [column, read] of Object.entries(reads) as [keyof LineFactors, (typeof reads)['qty']][]) {
    if (!read.ok) errors[column] = read.error;
  }
  if (reads.discountPct.ok && !isPercentInRange(reads.discountPct.value)) {
    errors.discountPct = { code: 'discount_out_of_range' };
  }
  const { qty, unitCost, unitPrice, discountPct } = reads;
  if (!qty.ok || !unitCost.ok || !unitPrice.ok || !discountPct.ok || errors.discountPct) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    factors: { qty: qty.value, unitCost: unitCost.value, unitPrice: unitPrice.value, discountPct: discountPct.value },
  };
}

/**
 * Validate and recompute ONE line. The client's totals are ignored entirely:
 * every figure on the returned row comes from the money engine (Money law).
 *
 * The FACTORS were each inside the cap; their PRODUCT need not be. A line total,
 * cost or margin past the cap overflows numeric(18,4), and a signed qty makes
 * the margin the widest of the three, so all three are checked; that refusal is
 * said under the quantity, and only once every cell reads. `sortOrder` falls
 * back to the line's position, so a client that omits it still gets a stable order.
 */
function validateVariationLine(
  line: VariationLineInput,
  index: number,
): { ok: true; line: PreparedVariationLine } | { ok: false; errors: LineErrors } {
  const descriptionAr = clean(line.descriptionAr);
  const descriptionEn = clean(line.descriptionEn);
  const read = readLineFactors(line);
  const errors: LineErrors = read.ok ? {} : { ...read.errors };
  if (!descriptionAr && !descriptionEn) errors.description = { code: 'line_required' };
  if (!line.unit) errors.unit = { code: 'line_required' };
  if (!read.ok || !line.unit || Object.keys(errors).length > 0) return { ok: false, errors };

  const totals = computeLine(read.factors);
  const overflows =
    !withinMagnitude(totals.lineTotal) ||
    !withinMagnitude(totals.lineCost) ||
    !withinMagnitude(totals.lineMargin);
  if (overflows) return { ok: false, errors: { qty: { code: 'amount_too_large' } } };

  return {
    ok: true,
    line: {
      contractLineId: line.contractLineId?.trim() || null,
      costItemId: line.costItemId?.trim() || null,
      descriptionAr,
      descriptionEn,
      unit: line.unit,
      sortOrder: line.sortOrder ?? index,
      ...read.factors,
      lineCost: totals.lineCost,
      lineTotal: totals.lineTotal,
      lineMargin: totals.lineMargin,
    },
  };
}

/**
 * Validate every line and compute the VO's net delta, BEFORE the transaction
 * opens. Nothing persists on a bad input, and every bad line is refused at once,
 * each under its own cell: a partially-saved variation is not a state this
 * product has.
 *
 * netDelta = Sigma lineTotal and may be negative (a pure de-scope). The SUM of
 * lines each inside the cap need not itself be inside it, which is why the last
 * magnitude check is not implied by the per-line ones; it is the whole VO's
 * refusal, not one cell's.
 */
export function validateVariationLines(lines: VariationLineInput[]): ValidatedVariationLines {
  if (lines.length > MAX_TOTAL_LINES) return { ok: false, refusal: err('too_many_lines') };

  const prepared: PreparedVariationLine[] = [];
  const errors: Record<string, FieldError> = {};
  lines.forEach((input, index) => {
    const validated = validateVariationLine(input, index);
    if (validated.ok) {
      prepared.push(validated.line);
      return;
    }
    for (const [column, error] of Object.entries(validated.errors) as [VariationLineColumn, FieldError][]) {
      errors[variationLinePath(index, column)] = error;
    }
  });
  if (prepared.length < lines.length) return { ok: false, refusal: fieldsFailed(errors) };

  const netDelta = computeVariationNetDelta(prepared);
  if (!withinMagnitude(netDelta)) return { ok: false, refusal: err('amount_too_large') };
  return { ok: true, lines: prepared, netDelta };
}
