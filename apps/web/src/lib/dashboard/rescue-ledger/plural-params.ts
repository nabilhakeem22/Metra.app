// The ICU values for a count in the rescue ledger's copy. PURE and CLIENT-SAFE.
//
// Two values per count, because one cannot do both jobs: the NUMBER selects the
// plural form (one / two / few / many in Arabic), and the Latin digit TEXT is
// what the reader sees. ICU's own `#` would print the locale's digits, which in
// ar-EG are Arabic-Indic (§4.1 forbids them).
import { formatNumber } from '@/lib/format/number';

export function pluralParams<C extends string, T extends string>(
  countKey: C,
  textKey: T,
  value: number,
  locale: string,
): Record<C, number> & Record<T, string> {
  return { [countKey]: value, [textKey]: formatNumber(value, locale) } as Record<C, number> & Record<T, string>;
}
