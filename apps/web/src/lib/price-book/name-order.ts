// How a price book is searched and ordered BY NAME, in the page's language.
// Pure and client-safe: the price-book page and the builder's picker share it,
// so a book of hundreds of items (the market seed adds about 450) is found by
// what an item is called, not by its code.

const TASHKEEL_TATWEEL_FORMAT = /\p{Mn}|\p{Cf}|\u0640/gu;

/**
 * The form a search compares: lower case, every whitespace run (NBSP too) as
 * one space, and the Arabic spellings a studio types interchangeably folded
 * together: أ/إ/آ as ا, ة as ه, ى and Persian ی as ي, Persian ک as ك, the
 * Arabic-Indic digits an Arabic phone keyboard types (٠-٩, ۰-۹) as 0-9, without
 * tashkeel, tatweel or invisible marks.
 */
export function searchForm(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKC')
    .replace(TASHKEEL_TATWEEL_FORMAT, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Whether `haystack` holds every word of `needle`, in any order («نحاس أسلاك»
 * finds «أسلاك نحاس معزول»). Both already in searchForm; an empty needle matches.
 */
export function hasEveryWord(haystack: string, needle: string): boolean {
  return needle.split(' ').every((word) => word === '' || haystack.includes(word));
}

/** A row's name in the page's language, the other language when that one is empty. */
export function nameIn(row: { nameAr: string | null; nameEn: string | null }, locale: string): string {
  const [first, second] = locale.startsWith('ar') ? [row.nameAr, row.nameEn] : [row.nameEn, row.nameAr];
  return (first?.trim() ? first : second) ?? '';
}

/** Orders rows by their name in the page's language (Arabic or English collation). */
export function byName(locale: string): (a: { nameAr: string | null; nameEn: string | null }, b: { nameAr: string | null; nameEn: string | null }) => number {
  const collator = new Intl.Collator(locale.startsWith('ar') ? 'ar' : 'en', { numeric: true, sensitivity: 'base' });
  return (a, b) => collator.compare(nameIn(a, locale), nameIn(b, locale));
}
