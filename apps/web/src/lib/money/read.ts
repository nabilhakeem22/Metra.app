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
 * Read `raw` as a canonical money string, or `null` if it is not one.
 *
 * Pipeline: canonicalise (digits, then separators) -> anchored MONEY_RE ->
 * sign rule -> clamp to the numeric(18,4) scale -> magnitude cap.
 */
export function readMoneyString(
  raw: string | null | undefined,
  options: ReadMoneyOptions = {},
): string | null {
  const { allowNegative = false, allowGroupSeparators = false } = options;
  const { allowArabicDigits = false, blank = null } = options;
  if (raw === null || raw === undefined) return blank;

  const latin = allowArabicDigits ? toLatinNumerals(raw) : raw;
  const canonical = allowGroupSeparators ? withoutSeparators(latin) : latin.trim();
  if (canonical === null) return null;
  if (canonical === '') return blank;

  if (!MONEY_RE.test(canonical)) return null;
  if (!allowNegative && canonical.startsWith('-')) return null;
  const clamped = clampMoney4(canonical);
  return withinMagnitude(clamped) ? clamped : null;
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

const ARABIC_NUMERALS_RE = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Arabic-Indic + Persian digits to Latin, U+066B (Arabic decimal separator) to
 *  '.'. U+066C (Arabic thousands separator) is LEFT IN PLACE — it is a grouping
 *  separator and goes through the same strict check as the comma. */
function toLatinNumerals(value: string): string {
  return value
    .replace(ARABIC_NUMERALS_RE, (digit) => {
      const code = digit.charCodeAt(0);
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    })
    .replace(/\u066B/g, '.');
}

/**
 * Everything a human or a spreadsheet uses to group thousands.
 *
 * A SPACE IS NOT NOISE. Stripping whitespace unconditionally read `'1 5'` as
 * `15` and `'1 2 3'` as `123` — the same ten-fold money error the comma rule
 * exists to prevent, wearing an invisible character. Two of these are invisible
 * (U+00A0, U+202F) and one more is easy to miss (U+066C), which is exactly why
 * each must prove it is in a thousands POSITION before it is removed.
 */
const GROUPING_SEPARATORS = [',', '\u066C', ' ', '\u00A0', '\u202F'];

/** Strict grouping with ONE separator: 1–3 leading digits, then groups of 3. */
function groupedWith(separator: string): RegExp {
  const escaped = separator === ',' ? ',' : `\\u${separator.charCodeAt(0).toString(16).padStart(4, '0')}`;
  return new RegExp(`^-?\\d{1,3}(${escaped}\\d{3})+(\\.\\d+)?$`);
}

/**
 * Strip grouping separators, or refuse. `null` = refuse.
 *
 * Outer whitespace is trimmed first — leading and trailing space is formatting,
 * not grouping. What is left may use ONE separator, in thousands positions only:
 * a second kind ('1 234,567') is a sheet whose own convention is unclear, and
 * guessing at that is how a rate becomes a thousand times itself.
 */
function withoutSeparators(value: string): string | null {
  const trimmed = value.trim();
  const used = GROUPING_SEPARATORS.filter((separator) => trimmed.includes(separator));
  if (used.length === 0) return trimmed;
  if (used.length > 1) return null;
  const [separator] = used;
  if (!groupedWith(separator).test(trimmed)) return null;
  return trimmed.split(separator).join('');
}
