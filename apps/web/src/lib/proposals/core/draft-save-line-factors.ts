// Stage 2c of the draft save: a line's four priced figures, each read or
// refused under its own cell. PURE and client-safe.
import type { FieldError } from '@/lib/actions/field-errors';
import { readMoneyField } from '@/lib/validation/field-rules';
import { isPercentInRange } from '@/lib/validation/percent';

/** The cells of a line a refusal can sit under. */
type LineColumn = 'description' | 'qty' | 'unit' | 'unitCost' | 'unitPrice' | 'discountPct';
export type LineErrors = Partial<Record<LineColumn, FieldError>>;

/** The four priced figures, each read or refused under its own cell: a figure
 *  past the cap says so, one that is not a number says that, a discount outside
 *  0 to 100 says that. */
export function readLineFactors(raw: {
  qty: string | null | undefined;
  unitCost: string | null;
  unitPrice: string | null;
  discountPct: string | null | undefined;
}):
  | { ok: true; factors: { qty: string; unitCost: string; unitPrice: string; discountPct: string } }
  | { ok: false; errors: LineErrors } {
  const reads = {
    qty: readMoneyField(raw.qty, { blank: '0' }),
    unitCost: readMoneyField(raw.unitCost, { blank: '0' }),
    unitPrice: readMoneyField(raw.unitPrice, { blank: '0' }),
    discountPct: readMoneyField(raw.discountPct, { blank: '0' }),
  };
  const errors: LineErrors = {};
  for (const [column, read] of Object.entries(reads) as [LineColumn, (typeof reads)['qty']][]) {
    if (!read.ok) errors[column] = read.error;
  }
  if (reads.discountPct.ok && !isPercentInRange(reads.discountPct.value)) {
    errors.discountPct = { code: 'discount_out_of_range' };
  }
  if (!reads.qty.ok || !reads.unitCost.ok || !reads.unitPrice.ok || !reads.discountPct.ok || errors.discountPct) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    factors: {
      qty: reads.qty.value,
      unitCost: reads.unitCost.value,
      unitPrice: reads.unitPrice.value,
      discountPct: reads.discountPct.value,
    },
  };
}
