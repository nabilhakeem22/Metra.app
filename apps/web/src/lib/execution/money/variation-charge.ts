// What an approved change order costs the client. PURE and CLIENT-SAFE.
//
// works = the order's `net_delta`; VAT = `pctOf(works, contract.tax_rate)`;
// supervision = `pctOf(works, contract.supervision_pct)` (decision D4: a change
// order carries supervision, the same rule as the contract), itself untaxed.
// Rounding is half away from zero and sign-symmetric, so a de-scope's charge
// is the exact negative of the add it reverses: it lowers the final account.
// Only an order that ADDS money is billed on its own (plan A11).
import { formatMoney4, parseMoney4, pctOf } from '@/lib/aggregates/proposal-totals';

export interface VariationCharge {
  works: string;
  tax: string;
  supervision: string;
  total: string;
}

export function variationCharge(netDelta: string, taxRate: string, supervisionPct: string): VariationCharge {
  const works4 = parseMoney4(netDelta);
  const tax4 = pctOf(works4, parseMoney4(taxRate));
  const supervision4 = pctOf(works4, parseMoney4(supervisionPct));
  return {
    works: formatMoney4(works4),
    tax: formatMoney4(tax4),
    supervision: formatMoney4(supervision4),
    total: formatMoney4(works4 + tax4 + supervision4),
  };
}

/** A change order may become a payment request only when it adds money (> 0). */
export function isVariationBillable(netDelta: string): boolean {
  return parseMoney4(netDelta) > 0n;
}
