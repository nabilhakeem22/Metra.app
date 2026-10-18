import { useTranslations } from 'next-intl';

/**
 * A line's unit code in the client's language, from `portal.units` (the
 * client-facing names, فصحى in Arabic): "م²" for `sqm` in Arabic, "m²" in
 * English. A client link page holds only its own messages, never the
 * studio's `priceBook.units`, so it names units from this sub-tree. A code
 * with no name in the catalogue shows as the code rather than breaking the
 * page.
 */
export function useClientUnitName(): (unit: string) => string {
  const t = useTranslations('portal.units');
  return (unit) => (t.has(unit) ? t(unit) : unit);
}
