// The final account (الحساب الختامي): contract + approved change orders +
// measured differences, minus everything already billed. PURE and CLIENT-SAFE:
// the final account card and the issue core compute one figure.
//
// Residual quantity of a measured line (plan A13) = measured - contract qty -
// Σ approved change-order qty on that line. Under decision D2(a) only a
// PROVISIONAL line is billed by measurement; a firm line whose residual is not
// zero is flagged "needs a change order" and adds nothing.
import { computeLine, formatMoney4, parseMoney4, pctOf } from '@/lib/aggregates/proposal-totals';
import { variationCharge } from './variation-charge';

export interface MeasuredLine {
  lineId: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  provisional: boolean;
  measuredQty: string;
  variationQty: string;
}

export interface FinalAccountInput {
  originalValue: string;
  taxRate: string;
  supervisionPct: string;
  /** The contract's document discount, applied to the measured works. */
  discountPct: string;
  approvedVariationNetDeltas: string[];
  measuredLines: MeasuredLine[];
  issuedRequestsTotal: string;
}

export interface FinalAccount {
  variationsCharge: string;
  /** Measured works after the document discount, before VAT and supervision. */
  adjustmentWorks: string;
  adjustmentCharge: string;
  finalValue: string;
  billedSoFar: string;
  /** May be zero or negative: then there is nothing left to bill. */
  balance: string;
  billedLines: { lineId: string; residualQty: string; works: string }[];
  flaggedLines: { lineId: string; residualQty: string }[];
}

/** Decision D2(a), as one named predicate: only a provisional line is remeasured. */
function billedByMeasurement(line: MeasuredLine): boolean {
  return line.provisional;
}

function residualQty4(line: MeasuredLine): bigint {
  return parseMoney4(line.measuredQty) - parseMoney4(line.qty) - parseMoney4(line.variationQty);
}

/** Every approved change order's full charge, de-scopes included (they lower it). */
function variationsCharge4(input: FinalAccountInput): bigint {
  return input.approvedVariationNetDeltas.reduce(
    (total, netDelta) => total + parseMoney4(variationCharge(netDelta, input.taxRate, input.supervisionPct).total),
    0n,
  );
}

export function computeFinalAccount(input: FinalAccountInput): FinalAccount {
  const billedLines: FinalAccount['billedLines'] = [];
  const flaggedLines: FinalAccount['flaggedLines'] = [];
  let measuredWorks4 = 0n;
  for (const line of input.measuredLines) {
    const residual4 = residualQty4(line);
    if (residual4 === 0n) continue;
    const residualQty = formatMoney4(residual4);
    if (!billedByMeasurement(line)) {
      flaggedLines.push({ lineId: line.lineId, residualQty });
      continue;
    }
    const { lineTotal } = computeLine({
      qty: residualQty,
      unitCost: '0',
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
    });
    billedLines.push({ lineId: line.lineId, residualQty, works: lineTotal });
    measuredWorks4 += parseMoney4(lineTotal);
  }

  const adjustmentWorks4 = measuredWorks4 - pctOf(measuredWorks4, parseMoney4(input.discountPct));
  // The measured works carry VAT and supervision by the same rule as a change order.
  const adjustment = variationCharge(formatMoney4(adjustmentWorks4), input.taxRate, input.supervisionPct);
  const variations4 = variationsCharge4(input);
  const finalValue4 = parseMoney4(input.originalValue) + variations4 + parseMoney4(adjustment.total);
  const billed4 = parseMoney4(input.issuedRequestsTotal);
  return {
    variationsCharge: formatMoney4(variations4),
    adjustmentWorks: adjustment.works,
    adjustmentCharge: adjustment.total,
    finalValue: formatMoney4(finalValue4),
    billedSoFar: formatMoney4(billed4),
    balance: formatMoney4(finalValue4 - billed4),
    billedLines,
    flaggedLines,
  };
}

/**
 * The balance with measured residuals left out: contract plus approved change
 * orders, minus issued requests (computeFinalAccount with no measured lines).
 * Before a final account request is issued, the delivery card steers on this;
 * measured differences enter only when the studio prepares the final account,
 * so a mid-job progress reading never reads as a refund or a shortfall.
 */
export function billingBalance(input: Omit<FinalAccountInput, 'measuredLines'>): string {
  return computeFinalAccount({ ...input, measuredLines: [] }).balance;
}
