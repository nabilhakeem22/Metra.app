// PURE proposal money engine. All money is scale-4 (NUMERIC(18,4)) carried as
// strings; arithmetic runs in BigInt at 1e-4 units so there is NO float drift.
// Rounding is half AWAY FROM ZERO on an exact .5, so it is SIGN-SYMMETRIC:
// round(-x) === -round(x). This makes a de-scope (negative-qty variation line)
// the exact inverse of the add it reverses (F1); for non-negative money it is
// identical to the previous half-up behaviour. No server-only imports.

/** Scale-4 unit (1e4 = 4 decimal places). Exported for proposal-totals only. */
export const SCALE = 10000n;

/** The money shape the server accepts. Shared with the builder's live preview so
 * the preview matches persistence (input the server would reject -> treated as 0). */
export const MONEY_RE = /^-?\d+(\.\d+)?$/;

/**
 * Is `value` a well-formed scale-4 money string? Total over `unknown`, because
 * every caller is reading an untyped JSONB transition payload where the field may
 * be a number, an object, or absent entirely. Rejects comma-decimals, Arabic-Indic
 * digits and exponent literals — `\d` is ASCII-only and the regex is anchored.
 *
 * It lives beside MONEY_RE so the shape and its guard cannot drift apart. It had
 * been declared privately inside the two payload validators, which is two chances
 * for one of them to be loosened on its own.
 */
export function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_RE.test(value.trim());
}

/**
 * Truncate a money string to at most 4 decimal places — the scale of every money
 * column in this schema (`numeric(18,4)`).
 *
 * WHY THIS EXISTS: `parseMoney4` TRUNCATES past the 4th decimal, but Postgres
 * ROUNDS when it stores into numeric(18,4). So an unclamped `2.99999` previewed as
 * 2.9999 in the app and came back as 3.0000 from the database — the same document
 * showing two different totals either side of a save, compounding over as many as
 * MAX_TOTAL_LINES rows. Clamping at every input boundary makes the two agree by
 * construction: a value that already has 4 or fewer decimals reaches the column
 * exactly, so there is nothing left for Postgres to round.
 *
 * Deliberately truncating (not rounding) and deliberately NOT canonicalising: it
 * matches `parseMoney4`, and `'5'` stays `'5'` rather than becoming `'5.0000'`, so
 * only the genuinely-ambiguous >4dp inputs change shape.
 */
export function clampMoney4(s: string): string {
  const dot = s.indexOf('.');
  if (dot < 0) return s;
  const frac = s.length - dot - 1;
  return frac > 4 ? s.slice(0, dot + 5) : s;
}

/** A non-negative money figure the server's parser will accept. */
export function isValidMoneyInput(s: string): boolean {
  const t = s.trim();
  return MONEY_RE.test(t) && !t.startsWith('-');
}

export function coerceMoneyInput(s: string): string {
  return isValidMoneyInput(s) ? clampMoney4(s.trim()) : '0';
}

/** floor(a / b) for b > 0 (BigInt / truncates toward zero). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n ? q - 1n : q;
}

/**
 * Round n/d half AWAY FROM ZERO on the exact half (d > 0). Sign-symmetric:
 * roundHalfAwayFromZero(-n, d) === -roundHalfAwayFromZero(n, d). For n >= 0 this
 * equals the old half-up (toward +inf), so non-negative money is unchanged.
 */
export function roundHalfAwayFromZero(n: bigint, d: bigint): bigint {
  if (n >= 0n) return floorDiv(2n * n + d, 2n * d);
  return -floorDiv(2n * -n + d, 2n * d);
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
export function mul(a: bigint, b: bigint): bigint {
  return roundHalfAwayFromZero(a * b, SCALE);
}

// value * pct% where pct is a scale-4 percentage (e.g. 14 -> 140000 units).
// Exported for reuse by the engagement deposit guard: it needs `design_fee ×
// (deposit% / 100)` with the SAME round-half-away-from-zero rule, never a
// re-implementation or parseFloat.
export function pctOf(value: bigint, pct: bigint): bigint {
  return roundHalfAwayFromZero(value * pct, SCALE * 100n);
}
