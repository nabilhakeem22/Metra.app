// The VAT inside the final account request (الحساب الختامي). PURE and
// CLIENT-SAFE. Every part of the final value carries VAT by one rule: the
// contract's own `tax_amount`, each approved change order's (rounded per order,
// as it is billed) and the measured works' (variationCharge on the adjustment).
// The final request carries what of that total is not yet billed: the total
// minus the VAT of every request issued before it. Rounding can leave a few
// piastres outside the request's bounds on a pathological schedule, so it is
// held inside them (`payment_requests_tax_amount_range`: 0 <= tax <= amount).
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { variationCharge } from './variation-charge';

export interface FinalAccountTaxInput {
  contractTaxAmount: string;
  taxRate: string;
  supervisionPct: string;
  approvedVariationNetDeltas: string[];
  /** The measured works after the document discount (`FinalAccountFigures.adjustmentWorks`). */
  adjustmentWorks: string;
  /** Σ tax_amount of the issued requests before the final account. */
  issuedRequestsTax: string;
  /** What the final account request bills, VAT included. */
  amount: string;
}

const taxOf = (works: string, input: FinalAccountTaxInput) =>
  parseMoney4(variationCharge(works, input.taxRate, input.supervisionPct).tax);

export function finalAccountTax(input: FinalAccountTaxInput): string {
  const variations4 = input.approvedVariationNetDeltas.reduce((total, netDelta) => total + taxOf(netDelta, input), 0n);
  const total4 = parseMoney4(input.contractTaxAmount) + variations4 + taxOf(input.adjustmentWorks, input);
  const due4 = total4 - parseMoney4(input.issuedRequestsTax);
  const amount4 = parseMoney4(input.amount);
  return formatMoney4(due4 < 0n ? 0n : due4 > amount4 ? amount4 : due4);
}
