import type { Translate } from '@/lib/actions/error-message';
import { formatMoneyExact } from '@/lib/format/money';

/** The refusal params that carry a scale-4 figure: what is still due, and a final account's new balance. */
const MONEY_PARAMS = ['outstanding', 'amount'] as const;

/**
 * The money dialogs' translator: a refusal that quotes a figure
 * (`payment_exceeds_request` {outstanding}, `final_account_changed` {amount})
 * says it as money, the way the dialog shows every figure, never as the raw
 * scale-4 string (A4 F7). Exact, not rounded: "Enter 0.0005 EGP or less" must
 * not read "0.00". The server keeps sending the raw figure, which is what an
 * API caller needs.
 */
export function withMoneyParams(translate: Translate, locale: string): Translate {
  return (key, values) => {
    if (!values) return translate(key, values);
    const formatted: Record<string, string | number> = { ...values };
    for (const param of MONEY_PARAMS) {
      const figure = values[param];
      if (typeof figure === 'string') formatted[param] = formatMoneyExact(figure, locale);
    }
    return translate(key, formatted);
  };
}
