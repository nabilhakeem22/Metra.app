// Proposal input validation — PURE and CLIENT-SAFE: no db import, no `server-only`,
// no 'use client'. Extracted from ./core.ts, which imports `server-only` (via its
// db/action dependencies) and therefore could not be loaded by a plain unit test.
//
// That was the whole reason `proposals` had 12 source files and zero unit tests: the
// validators standing between a pasted string and a money column were only reachable
// through a database suite. They are the cheapest, highest-value thing to prove, so
// they live here now and ./core.ts re-exports them — every existing import site keeps
// resolving unchanged.
import { MONEY_RE, clampMoney4 } from '@/lib/aggregates/proposal-totals';

export const SHARE_TTL_DAYS = 30;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R2 boundary caps (named so the tests + UI can agree on them).
export const MAX_SECTIONS = 100;
export const MAX_LINES_PER_SECTION = 500;
export const MAX_TOTAL_LINES = 2000;
// F4 money magnitude cap — numeric(18,4) tops out near 1e14; stay well under.
export const MAX_AMOUNT = 1_000_000_000_000; // 1e12
export const LINE_INSERT_CHUNK = 500;

export function normalizeText(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** Non-negative money string or null. */
export function normalizeMoney(
  v: string | null | undefined,
  fallback = '0',
): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return fallback;
  if (!MONEY_RE.test(s) || s.startsWith('-')) return null;
  // Clamp to the column's scale so the previewed total and the stored total agree
  // (the app truncates past 4dp, numeric(18,4) rounds — see clampMoney4).
  return clampMoney4(s);
}

/**
 * Within the money magnitude cap. Shape-checked FIRST: `Number()` alone happily
 * reads '0x10' as 16, '1e2' as 100 and '' as 0, so a caller that reached here
 * without normalizeMoney would silently accept a hex or exponent literal as an
 * amount. Every current call site does normalize first, which is why this has
 * never bitten — the check is here so that stays true by construction rather than
 * by convention.
 */
export function withinMagnitude(s: string): boolean {
  if (!MONEY_RE.test(s.trim())) return false;
  return Math.abs(Number(s)) <= MAX_AMOUNT;
}

/** A percentage between 0 and 100 inclusive. Shape-checked first, for the same
 *  reason as {@link withinMagnitude} — and because '' must not read as 0%. */
export function pctInRange(s: string): boolean {
  const t = s.trim();
  if (!MONEY_RE.test(t) || t.startsWith('-')) return false;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

export function validIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
