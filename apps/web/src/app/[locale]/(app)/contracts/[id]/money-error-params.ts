import type { Translate } from '@/lib/actions/error-message';
import { formatMoneyExact } from '@/lib/format/money';

/**
 * The record dialog's translator: a refusal that quotes what is still due
 * (`payment_exceeds_request` {outstanding}) says it as money, the way the
 * dialog shows every figure, never as the raw scale-4 string (A4 F7). Exact,
 * not rounded: "Enter 0.0005 EGP or less" must not read "0.00". The server
 * keeps sending the raw figure, which is what an API caller needs.
 */
export function withMoneyParams(translate: Translate, locale: string): Translate {
  return (key, values) => {
    const outstanding = values?.outstanding;
    if (typeof outstanding !== 'string') return translate(key, values);
    return translate(key, { ...values, outstanding: formatMoneyExact(outstanding, locale) });
  };
}
