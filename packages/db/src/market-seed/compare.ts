// ONE comparison form for every name and section the seed checks, in both
// languages: Unicode NFKC, no format characters (RLM, LRM, ALM, ZWJ, ZWNJ),
// Persian yeh and kaf as their Arabic letters, then the Arabic folding of
// ./normalize.ts (alef forms, ta marbuta, alef maqsura, tatweel, diacritics,
// Arabic-Indic digits, every whitespace run including NBSP as one space), then
// lower case. Two names with the same form read alike to a studio.
import { normalizeArabic } from './normalize';

export function comparisonForm(text: string | null): string {
  if (text === null) return '';
  const plain = text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/ی/g, 'ي').replace(/ک/g, 'ك');
  return normalizeArabic(plain).toLowerCase();
}
