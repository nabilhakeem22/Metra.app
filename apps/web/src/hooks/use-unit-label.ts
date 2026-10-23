import { useTranslations } from 'next-intl';

/**
 * A unit code's name in the page's language, from the price book's unit names
 * (`priceBook.units`): "م²" for `sqm` in Arabic, "m²" in English. The code stays
 * the stored value; this only names it. A code with no name yet in the
 * catalogue shows as the code itself rather than breaking the page.
 */
export function useUnitLabel(): (unit: string) => string {
  const t = useTranslations('priceBook.units');
  return (unit) => (t.has(unit) ? t(unit) : unit);
}
