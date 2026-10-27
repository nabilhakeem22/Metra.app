// PURE proposal totals: line, section and document arithmetic over the scale-4
// money primitives in ./money4 (re-exported below so every import path is
// unchanged). No server-only imports.
import { formatMoney4, mul, parseMoney4, pctOf } from './money4';

export {
  MONEY_RE,
  isMoneyString,
  clampMoney4,
  isValidMoneyInput,
  coerceMoneyInput,
  roundHalfAwayFromZero,
  parseMoney4,
  formatMoney4,
  pctOf,
} from './money4';

export interface LineInput {
  qty: string;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}

export interface LineTotals {
  lineCost: string;
  lineTotal: string;
  lineMargin: string;
}

export function computeLine(input: LineInput): LineTotals {
  const qty = parseMoney4(input.qty);
  const unitCost = parseMoney4(input.unitCost);
  const unitPrice = parseMoney4(input.unitPrice);
  const discountPct = parseMoney4(input.discountPct);

  const lineCost = mul(qty, unitCost);
  const lineGross = mul(qty, unitPrice);
  const lineTotal = lineGross - pctOf(lineGross, discountPct);
  const lineMargin = lineTotal - lineCost;

  return {
    lineCost: formatMoney4(lineCost),
    lineTotal: formatMoney4(lineTotal),
    lineMargin: formatMoney4(lineMargin),
  };
}

export interface SectionTotals {
  sectionSubtotal: string;
  sectionCost: string;
  sectionMargin: string;
}

export function computeSection(lines: LineTotals[]): SectionTotals {
  let subtotal = 0n;
  let cost = 0n;
  let margin = 0n;
  for (const l of lines) {
    subtotal += parseMoney4(l.lineTotal);
    cost += parseMoney4(l.lineCost);
    margin += parseMoney4(l.lineMargin);
  }
  return {
    sectionSubtotal: formatMoney4(subtotal),
    sectionCost: formatMoney4(cost),
    sectionMargin: formatMoney4(margin),
  };
}

export interface DocInput {
  discountPct: string;
  taxRate: string;
  // Supervision fee as a percentage of the taxable base, charged AFTER VAT and
  // itself untaxed. Optional so existing call sites/tests compile unchanged.
  supervisionPct?: string;
}

export interface DocTotals {
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  supervisionAmount: string;
  total: string;
  totalCost: string;
  totalMargin: string;
}

export function computeTotals(
  sections: SectionTotals[],
  doc: DocInput,
): DocTotals {
  let subtotal = 0n;
  let totalCost = 0n;
  for (const s of sections) {
    subtotal += parseMoney4(s.sectionSubtotal);
    totalCost += parseMoney4(s.sectionCost);
  }
  const discountPct = parseMoney4(doc.discountPct);
  const taxRate = parseMoney4(doc.taxRate);
  const supervisionPct = parseMoney4(doc.supervisionPct ?? '0');

  const discountAmount = pctOf(subtotal, discountPct);
  const taxableBase = subtotal - discountAmount;
  const taxAmount = pctOf(taxableBase, taxRate);
  // Supervision is levied on the taxable base and NOT taxed itself.
  const supervisionAmount = pctOf(taxableBase, supervisionPct);
  const total = taxableBase + taxAmount + supervisionAmount;
  const totalMargin = taxableBase - totalCost;

  return {
    subtotal: formatMoney4(subtotal),
    discountAmount: formatMoney4(discountAmount),
    taxableBase: formatMoney4(taxableBase),
    taxAmount: formatMoney4(taxAmount),
    supervisionAmount: formatMoney4(supervisionAmount),
    total: formatMoney4(total),
    totalCost: formatMoney4(totalCost),
    totalMargin: formatMoney4(totalMargin),
  };
}

/** marginPct = totalMargin / taxableBase (render-only; null if base <= 0). */
export function marginPct(totalMargin: string, taxableBase: string): number | null {
  const base = parseMoney4(taxableBase);
  if (base <= 0n) return null;
  const m = parseMoney4(totalMargin);
  // Two-decimal percentage as a JS number (display only, never persisted).
  return Number((Number(m) / Number(base)) * 100);
}
