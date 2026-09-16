// Proposal input validation — PURE and CLIENT-SAFE: no db import, no `server-only`,
// no 'use client'. Extracted from ./core.ts, which imports `server-only` (via its
// db/action dependencies) and therefore could not be loaded by a plain unit test.
//
// That was the whole reason `proposals` had 12 source files and zero unit tests: the
// validators standing between a pasted string and a money column were only reachable
// through a database suite. They are the cheapest, highest-value thing to prove, so
// they live here now and ./core.ts re-exports them — every existing import site keeps
// resolving unchanged.
import { MONEY_RE } from '@/lib/aggregates/proposal-totals';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The section/line caps are not proposal-specific — contracts, variations and
// BOQs enforce the same numbers — so they live in the line kernel. Re-exported
// here so the sites that import them from this module keep resolving unchanged.
export {
  MAX_SECTIONS,
  MAX_LINES_PER_SECTION,
  MAX_TOTAL_LINES,
  LINE_INSERT_CHUNK,
} from '@/lib/lines/limits';

// The money magnitude cap and its guard are not proposal-specific — BOQs,
// variations and the price book enforce them too — so they live in the money
// kernel. Re-exported here so the ~12 sites that import them from this module
// keep resolving unchanged.
export { MAX_AMOUNT, withinMagnitude } from '@/lib/money/read';

export function normalizeText(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** A percentage between 0 and 100 inclusive. Shape-checked first, for the same
 *  reason as {@link withinMagnitude} — `Number()` reads '0x10' as 16, '1e2' as
 *  100 and '' as 0, and '' must not read as 0%. */
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
