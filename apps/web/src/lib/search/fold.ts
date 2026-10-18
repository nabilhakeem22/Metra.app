// How what a studio types is folded before it is compared: the one spelling
// rule every search in the app shares (the price book, the builder's picker,
// the contract's baseline-line picker). Pure and client-safe, so a list
// searched in the browser and a search run in Postgres (./words-sql.ts) agree.

const TASHKEEL_TATWEEL_FORMAT = /\p{Mn}|\p{Cf}|ـ/gu;

/**
 * The characters a studio types interchangeably, each folded to ONE spelling:
 * أ/إ/آ as ا, ة as ه, ى and Persian ی as ي, Persian ک as ك, the Arabic-Indic
 * digits an Arabic phone keyboard types (٠-٩, ۰-۹) as 0-9, and its decimal mark
 * ٫ as a point. `from[i]` folds to `to[i]`. The SQL search (./words-sql.ts)
 * folds with these same two strings, so a search run in the database and a
 * list searched here agree.
 */
export const SEARCH_FOLD = {
  from: 'أإآةىیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫',
  to: 'اااهييك01234567890123456789.',
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
