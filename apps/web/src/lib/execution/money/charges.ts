// The execution contract's totals, built on top of an ISSUED BOQ. PURE and
// CLIENT-SAFE: exact scale-4 BigInt money (never float), reusing the proposal
// money engine's `pctOf` so VAT and supervision round half away from zero
// exactly as every other document in Metra does.
//
// The works value is the BOQ `total` to the piastre, never recomputed from the
// lines (plan A4): the client signs the figure the BOQ was issued at. VAT and
// supervision are both levied on that base, and supervision is itself untaxed.
import { formatMoney4, parseMoney4, pctOf } from '@/lib/aggregates/proposal-totals';

/** The frozen totals of the issued BOQ the contract is generated from. */
export interface BoqTotalsSnapshot {
  subtotal: string;
  discountPct: string;
  discountAmount: string;
  total: string;
  totalCost: string;
  totalMargin: string;
}

/** The two rates the studio sets on the contract (already validated, [0, 100]). */
export interface ContractCharges {
  taxRate: string;
  supervisionPct: string;
}

/** Every money column of the contract row, canonical at scale 4. */
export interface ContractTotals {
  subtotal: string;
  discountPct: string;
  discountAmount: string;
  taxableBase: string;
  taxRate: string;
  taxAmount: string;
  supervisionPct: string;
  supervisionAmount: string;
  originalValue: string;
  totalCost: string;
  totalMargin: string;
}

/** A scale-4 string in its one canonical spelling ('14' -> '14.0000'). */
function canonical(value: string): string {
  return formatMoney4(parseMoney4(value));
}

/**
 * taxableBase = the BOQ total; taxAmount and supervisionAmount = `pctOf` that
 * base; originalValue = base + VAT + supervision. Cost and margin are copied
 * from the BOQ as they were frozen at issue.
 */
export function contractTotalsFromBoq(
  boq: BoqTotalsSnapshot,
  charges: ContractCharges,
): ContractTotals {
  const taxableBase = parseMoney4(boq.total);
  const taxAmount = pctOf(taxableBase, parseMoney4(charges.taxRate));
  const supervisionAmount = pctOf(taxableBase, parseMoney4(charges.supervisionPct));
  return {
    subtotal: canonical(boq.subtotal),
    discountPct: canonical(boq.discountPct),
    discountAmount: canonical(boq.discountAmount),
    taxableBase: formatMoney4(taxableBase),
    taxRate: canonical(charges.taxRate),
    taxAmount: formatMoney4(taxAmount),
    supervisionPct: canonical(charges.supervisionPct),
    supervisionAmount: formatMoney4(supervisionAmount),
    originalValue: formatMoney4(taxableBase + taxAmount + supervisionAmount),
    totalCost: canonical(boq.totalCost),
    totalMargin: canonical(boq.totalMargin),
  };
}
