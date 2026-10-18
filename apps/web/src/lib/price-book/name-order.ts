// How a price book is searched and ordered BY NAME, in the page's language.
// Pure and client-safe, so a book of hundreds of items (the market seed adds
// about 450) is found by what an item is called, not by its code. The price-book
// page and the builder's picker search in Postgres with the same folds
// (search-sql.ts); this module folds what is typed, names a row, and sorts a
// list the server sent whole (the BOQ template).

const TASHKEEL_TATWEEL_FORMAT = /\p{Mn}|\p{Cf}|ـ/gu;

/**
 * The characters a studio types interchangeably, each folded to ONE spelling:
 * أ/إ/آ as ا, ة as ه, ى and Persian ی as ي, Persian ک as ك, and the
 * Arabic-Indic digits an Arabic phone keyboard types (٠-٩, ۰-۹) as 0-9. `from[i]`
 * folds to `to[i]`. The SQL search (search-sql.ts) folds with these same two
 * strings, so the page searched in the database and a list searched here agree.
 */
export const SEARCH_FOLD = {
  from: 'أإآةىیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
  to: 'اااهييك01234567890123456789',
} as const;

const FOLDED = new Map([...SEARCH_FOLD.from].map((character, index) => [character, SEARCH_FOLD.to[index]]));
const FOLDABLE = new RegExp(`[${SEARCH_FOLD.from}]`, 'gu');

/**
 * The form a search compares: lower case, every whitespace run (NBSP too) as
 * one space, the SEARCH_FOLD spellings folded together, without tashkeel,
 * tatweel or invisible marks.
 */
export function searchForm(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKC')
    .replace(TASHKEEL_TATWEEL_FORMAT, '')
    .replace(FOLDABLE, (character) => FOLDED.get(character) ?? character)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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
