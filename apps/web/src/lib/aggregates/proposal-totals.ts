// PURE proposal money engine. All money is scale-4 (NUMERIC(18,4)) carried as
// strings; arithmetic runs in BigInt at 1e-4 units so there is NO float drift.
// Rounding is half-up (toward +infinity on an exact .5). No server-only imports.

const SCALE = 10000n; // 1e4 (4 decimal places)

/** The money shape the server accepts. Shared with the builder's live preview so
 * the preview matches persistence (input the server would reject -> treated as 0). */
export const MONEY_RE = /^-?\d+(\.\d+)?$/;

export function coerceMoneyInput(s: string): string {
  const t = s.trim();
  return MONEY_RE.test(t) && !t.startsWith('-') ? t : '0';
}

/** floor(a / b) for b > 0 (BigInt / truncates toward zero). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/** Round n/d half-up (toward +inf on the exact half). d > 0. */
function roundHalfUp(n: bigint, d: bigint): bigint {
  return floorDiv(2n * n + d, 2n * d);
}

/** Parse a decimal string into scale-4 BigInt units (truncates beyond 4 dp). */
export function parseMoney4(s: string | number | null | undefined): bigint {
  if (s === null || s === undefined) return 0n;
  const str = String(s).trim();
  if (str === '') return 0n;
  const neg = str.startsWith('-');
  const body = str.replace(/^[+-]/, '');
  const [intPart = '0', fracRaw = ''] = body.split('.');
  const frac = (fracRaw + '0000').slice(0, 4);
  const digits = (intPart || '0').replace(/\D/g, '') || '0';
  const v = BigInt(digits) * SCALE + BigInt(frac || '0');
  return neg ? -v : v;
}

/** Format scale-4 BigInt units as a canonical decimal string with 4 dp. */
export function formatMoney4(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const intPart = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(4, '0');
  return `${neg ? '-' : ''}${intPart}.${frac}`;
}

// scale-4 * scale-4 -> scale-4
function mul(a: bigint, b: bigint): bigint {
  return roundHalfUp(a * b, SCALE);
}

// value * pct% where pct is a scale-4 percentage (e.g. 14 -> 140000 units).
function pctOf(value: bigint, pct: bigint): bigint {
  return roundHalfUp(value * pct, SCALE * 100n);
}

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
}

export interface DocTotals {
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
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

  const discountAmount = pctOf(subtotal, discountPct);
  const taxableBase = subtotal - discountAmount;
  const taxAmount = pctOf(taxableBase, taxRate);
  const total = taxableBase + taxAmount;
  const totalMargin = taxableBase - totalCost;

  return {
    subtotal: formatMoney4(subtotal),
    discountAmount: formatMoney4(discountAmount),
    taxableBase: formatMoney4(taxableBase),
    taxAmount: formatMoney4(taxAmount),
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
