/**
 * One reader for every money string a human types into Metra.
 *
 * PURE and CLIENT-SAFE (the builder's live preview loads it): no `server-only`,
 * no 'use client', no db import.
 *
 * There were six of these — `normalizeMoney`, `normMoney`, `readNumericField`,
 * `parseMoney`, `parseNumericCell`, `normalizeSignedMoney` — and they disagreed on
 * the thing that matters most: what a comma means. Three of them stripped every
 * comma unconditionally, so `'1,5'` (how half of Egypt writes one and a half)
 * saved as `15`. That is a ten-fold money error that no validation layer below
 * would ever catch, because `15` is a perfectly legal amount. Here the comma is
 * accepted ONLY in strict thousands grouping and refused everywhere else.
 */
import { MONEY_RE, clampMoney4 } from '@/lib/aggregates/proposal-totals';
import { toLatinNumerals, withoutSeparators } from './separators';

/** F4 magnitude cap — numeric(18,4) tops out near 1e14, so stay well under it. */
export const MAX_AMOUNT = 1_000_000_000_000; // 1e12

export interface ReadMoneyOptions {
  /** Accept a leading '-'. Off by default: only de-scopes and variation deltas
   *  may be negative, and every other column has a non-negative CHECK. */
  allowNegative?: boolean;
  /** Accept a thousands separator inside the number. EVERY separator obeys the
   *  same strict rule — the ASCII comma, the Arabic thousands mark (U+066C) and
   *  the three spaces a paste out of Excel carries (space, NBSP U+00A0, narrow
   *  NBSP U+202F): accepted ONLY in grouped form (`1,200`, `12 345 678.90`) with
   *  ONE consistent separator, then stripped. `'1,5'`, `'1 5'`, `'1 2 3'`,
   *  `'1.234,56'` and `'1 234,567'` are REFUSED rather than silently re-read.
   *  Outer whitespace is trimmed, not parsed. */
  allowGroupSeparators?: boolean;
  /** Map Arabic-Indic (U+0660–U+0669) and Persian (U+06F0–U+06F9) digits to Latin,
   *  and read U+066B as the decimal point. For spreadsheet cells typed on an
   *  Arabic keyboard, where `Number('١٢')` is NaN and the whole sheet would import
   *  as a page of errors. NOT enabled on typed-in form fields. */
  allowArabicDigits?: boolean;
  /** What an absent or empty input reads as. Default `null` = refuse, because a
   *  rate the studio CLEARED is a question for the caller, not a zero. */
  blank?: string | null;
}

/**
 * What a money string read as, or WHY it did not.
 *
 * The reason is the point. Every caller used to see one `null` and answer with
 * its own generic code, so a pasted 1e13 quantity was reported as "not a
 * number" — which is both wrong and unactionable, because the studio can see
 * perfectly well that it IS a number. `too_large` says the one true thing.
 */
export type ReadMoneyResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'invalid' | 'too_large' };

const INVALID: ReadMoneyResult = { ok: false, reason: 'invalid' };

/** An absent/empty input: the caller's `blank`, or a refusal when it has none. */
function fromBlank(blank: string | null): ReadMoneyResult {
  return blank === null ? INVALID : { ok: true, value: blank };
}

/**
 * Read `raw` as a canonical money string, or say why it is not one.
 *
 * Pipeline: canonicalise (digits, then separators) -> anchored MONEY_RE ->
 * sign rule -> clamp to the numeric(18,4) scale -> magnitude cap.
 */
export function readMoney(
  raw: string | null | undefined,
  options: ReadMoneyOptions = {},
): ReadMoneyResult {
  const { allowNegative = false, allowGroupSeparators = false } = options;
  const { allowArabicDigits = false, blank = null } = options;
  if (raw === null || raw === undefined) return fromBlank(blank);

  const latin = allowArabicDigits ? toLatinNumerals(raw) : raw;
  const canonical = allowGroupSeparators ? withoutSeparators(latin) : latin.trim();
  if (canonical === null) return INVALID;
  if (canonical === '') return fromBlank(blank);

  if (!MONEY_RE.test(canonical)) return INVALID;
  if (!allowNegative && canonical.startsWith('-')) return INVALID;
  const clamped = clampMoney4(canonical);
  if (!withinMagnitude(clamped)) return { ok: false, reason: 'too_large' };
  return { ok: true, value: clamped };
}

/**
 * The string form: the value, or `null` for any failure.
 *
 * Most callers have exactly one thing to say about an unreadable field and this
 * is the shape for them. A caller that must tell "not a number" from "past the
 * cap" — the line editors, the draft save, the importer — reads `readMoney`.
 */
export function readMoneyString(
  raw: string | null | undefined,
  options: ReadMoneyOptions = {},
): string | null {
  const result = readMoney(raw, options);
  return result.ok ? result.value : null;
}

/**
 * Is `value` inside the money magnitude cap? Shape-checked FIRST, because
 * `Number()` alone reads '0x10' as 16, '1e2' as 100 and '' as 0 — a caller that
 * reached here without reading the value first would silently accept a hex or
 * exponent literal as an amount.
 */
export function withinMagnitude(value: string): boolean {
  if (!MONEY_RE.test(value.trim())) return false;
  return Math.abs(Number(value)) <= MAX_AMOUNT;
}
