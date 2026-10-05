import { formatMoney, formatMoneyAmount, type MoneyFormatOptions } from '@/lib/format/money';

/**
 * How the portal's budget and payments cards print money: the shared formatter
 * with whole amounts trimmed ("120,000", but "20,000.50"), as the approved mockup
 * shows. Only these cards opt in; every other surface keeps "120,000.00".
 */
const PORTAL_MONEY: MoneyFormatOptions = { trimWholeDecimals: true };

/** An amount with its currency label: "120,000 EGP" / "120,000 ج.م". */
export function formatPortalMoney(amount: string | null | undefined, locale: string): string {
  return formatMoney(amount, locale, PORTAL_MONEY);
}

/** The figure alone, for a layout that shows the label once: "120,000". */
export function formatPortalAmount(amount: string | null | undefined, locale: string): string {
  return formatMoneyAmount(amount, locale, PORTAL_MONEY);
}
