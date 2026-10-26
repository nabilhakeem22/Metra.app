import { formatMoney, formatMoneyAmount, isWholeMoney, type MoneyFormatOptions } from '@/lib/format/money';

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

/** One list's money formatter: an amount with its currency label, under the list's decimals rule. */
export type PortalListMoney = (amount: string) => string;

/**
 * ONE decimals rule for every amount of a list: whole amounts trimmed only
 * while every amount in it is whole, else all at 2 decimals, so "512,709" never
 * stands beside "307,625.40" (the B4 /d defect).
 */
export function portalListMoney(amounts: readonly string[], locale: string): PortalListMoney {
  const options: MoneyFormatOptions = { trimWholeDecimals: amounts.every(isWholeMoney) };
  return (amount) => formatMoney(amount, locale, options);
}
