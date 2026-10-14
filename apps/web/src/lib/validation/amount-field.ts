// The ONE reader for an amount a studio TYPES into a money box (a payment, the
// design fee and its split, the build-cost range, the price book). Pure and
// client-safe: the form's pre-check and the server core read the same figure.
//
// It accepts what Egyptian studios actually type, and refuses what is
// ambiguous: "1,500" (strict thousands grouping), Arabic-Indic digits and the
// Arabic decimal mark, and a currency mark around the figure ("1500 EGP",
// "1500 ج.م"). "1,5" is still refused, never read as 15 (money/read.ts).
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FieldError } from '@/lib/actions/field-errors';
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
