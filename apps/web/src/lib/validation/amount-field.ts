// The ONE reader for an amount a studio TYPES into a money box (a payment, the
// design fee and its split, the build-cost range, a revision's change order,
// the price book). Pure and
// client-safe: the form's pre-check and the server core read the same figure.
//
// It accepts what Egyptian studios actually type, and refuses what is
// ambiguous: "1,500" (strict thousands grouping), Arabic-Indic digits and the
// Arabic decimal mark, and a currency mark around the figure ("1500 EGP",
// "1500 ج.م"). "1,5" is still refused, never read as 15 (money/read.ts).
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FieldError } from '@/lib/actions/field-errors';
import { toLatinNumerals, withoutSeparators } from '@/lib/money/separators';
import { readMoneyField, type FieldRead } from './field-rules';
import { clean } from './text';

/** A currency mark typed before or after the figure: EGP, LE, L.E., ج.م, جنيه. */
const CURRENCY_MARK = /^(?:EGP|L\.?E\.?|ج\.?\s?م\.?|جنيه)\s*|\s*(?:EGP|L\.?E\.?|ج\.?\s?م\.?|جنيه)$/giu;

/** The figure without the currency mark around it. */
function withoutCurrencyMark(raw: string | null | undefined): string | null | undefined {
  return typeof raw === 'string' ? raw.trim().replace(CURRENCY_MARK, '').trim() : raw;
}

/**
 * A typed money box at scale 4, or the refusal under it: not_a_number,
 * not_negative, or amount_too_large past the column's cap. `blank` is what an
 * empty box reads as (null refuses it as not_a_number).
 */
export function readTypedMoney(raw: string | null | undefined, blank: string | null = null): FieldRead<string> {
  return readMoneyField(withoutCurrencyMark(raw), { allowGroupSeparators: true, allowArabicDigits: true, blank });
}

/**
 * A strictly positive typed amount, canonical at scale 4. An empty box or a
 * zero is the domain's own "enter an amount" refusal (`missing`); anything
 * else unreadable says why, never "missing or zero".
 */
export function readPositiveAmount(raw: unknown, missing: FieldError): FieldRead<string> {
  if (typeof raw !== 'string' || clean(raw) === null) return { ok: false, error: missing };
  const read = readTypedMoney(raw);
  if (!read.ok) return read;
  const amount4 = parseMoney4(read.value);
  return amount4 > 0n ? { ok: true, value: formatMoney4(amount4) } : { ok: false, error: missing };
}

/** The decimals an amount is stored to (numeric(18,4)). */
const STORED_DECIMALS = 4;

/** How many decimals the figure was typed with, read the way the box reads it (digits, grouping, currency mark). */
function typedDecimals(raw: string): number {
  const canonical = withoutSeparators(toLatinNumerals(withoutCurrencyMark(raw) ?? ''));
  return canonical === null ? 0 : (/\.(\d*)$/.exec(canonical)?.[1].length ?? 0);
}

const TOO_MANY_DECIMALS: FieldRead<string> = { ok: false, error: { code: 'too_many_decimals', params: { max: STORED_DECIMALS } } };

/**
 * readPositiveAmount, except that a figure typed with more decimals than it is
 * stored to is refused (`too_many_decimals`), never cut: 100.12345 is not
 * 100.1234, and 0.00001 is not "missing". The contract payment ledger reads
 * its amount this way (A4 F8); the older callers keep readPositiveAmount.
 */
export function readPositiveExactAmount(raw: unknown, missing: FieldError): FieldRead<string> {
  if (typeof raw === 'string' && typedDecimals(raw) > STORED_DECIMALS) return TOO_MANY_DECIMALS;
  return readPositiveAmount(raw, missing);
}

/**
 * A typed figure that may be ZERO (a line measured at nothing is a real
 * reading), canonical at scale 4, a fifth decimal refused, read the way every
 * box reads ("1,500", Arabic digits). An empty box is `required`; below zero
 * is `not_negative`. The site measurement reads its quantity this way.
 */
export function readNonNegativeExactFigure(raw: unknown): FieldRead<string> {
  if (typeof raw !== 'string' || clean(raw) === null) return { ok: false, error: { code: 'required' } };
  if (typedDecimals(raw) > STORED_DECIMALS) return TOO_MANY_DECIMALS;
  const read = readTypedMoney(raw);
  return read.ok ? { ok: true, value: formatMoney4(parseMoney4(read.value)) } : read;
}
