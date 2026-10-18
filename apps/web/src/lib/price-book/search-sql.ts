import 'server-only';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { SEARCH_FOLD, searchForm } from './name-order';

// The price book searched and ordered BY NAME in Postgres, so a page of a
// 2,000-item book costs the Worker one page of rows, not the whole book.
//
// SEARCH folds exactly as searchForm (name-order.ts) does, with one known gap:
// searchForm drops EVERY combining mark (\p{Mn}) and format character (\p{Cf});
// Postgres has no \p classes, so STRIPPED_MARKS lists exactly those characters
// in the blocks a price book draws on (Latin and its combining accents, Arabic
// and its extension, the general punctuation's zero-width and direction marks,
// variation selectors, tatweel); its test proves it strips nothing searchForm
// keeps. A mark of another script (Hebrew points, Indic vowel signs) is kept in
// SQL. Node and Postgres may run different Unicode versions, which matters only
// for recently assigned characters. Whitespace is not collapsed in SQL, and need
// not be: a searched word never holds a space. lower() follows the database's
// ctype: under "C" it lowers ASCII only, so «CAFÉ» typed «café» is missed there.
// `collate "pg_c_utf8"` would lower all of Unicode for about 2 ms per 2,000 rows,
// but exists only from PostgreSQL 17; it waits until production's version is
// confirmed. A table of Latin capitals in translate() cost 115 ms, so no.
//
// ORDER follows Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
// which the page used to sort with, under the "C" collation, so the order is the
// same on every server and needs no ICU collation: hamza carriers sort as alef,
// ة beside ت, accents ignored, digit runs compared as numbers, and (in Arabic)
// Arabic script before Latin. Measured on the July 2026 bulletin's 447 names: 23
// of 113,526 pairs differ in Arabic and 3 in English, every one a tie or a
// punctuation mark («°» against «،»).

/** One regex class: the marks searchForm drops that a price book can hold. Exported for its test. */
export const STRIPPED_MARKS =
  '[\u00ad\u0300-\u036f\u0600-\u0605\u0610-\u061a\u061c\u0640\u064b-\u065f\u0670\u06d6-\u06dd' +
  '\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0890\u0891\u0897-\u089f\u08ca-\u08ff\u1ab0-\u1abd\u1abf-\u1ace\u1dc0-\u1dff' +
  '\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u20d0-\u20dc\u20e1\u20e5-\u20f0' +
  '\ufe00-\ufe0f\ufe20-\ufe2f\ufeff]';

/** The characters JS trim() removes: a name of only these is blank, as nameIn reads it. */
const BLANK = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/** The sort's own folds: hamza carriers as alef, ة as ت, ى/ی as ي, ک as ك, digits as Latin. */
const SORT_FOLD = { from: 'أإآٱؤئءةىیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', to: 'اااااااتييك01234567890123456789' };
const LATIN = 'abcdefghijklmnopqrstuvwxyz';
/** Fullwidth Latin sorts after every Arabic letter under "C": Arabic first, as ICU's Arabic order has it. */
const LATIN_AFTER_ARABIC = [...LATIN].map((letter) => String.fromCodePoint(letter.charCodeAt(0) - 0x61 + 0xff41)).join('');
const BACKSLASH = String.fromCharCode(92);
const DIGIT_RUN_PADDED = `0000000000${BACKSLASH}1`;
const LAST_TEN_DIGITS = `${BACKSLASH}1`;

/** `text` in searchForm's form. */
export function searchFormSql(text: SQLWrapper): SQL {
  return sql`lower(translate(regexp_replace(normalize(${text}, NFKC), ${STRIPPED_MARKS}::text, '', 'g'), ${SEARCH_FOLD.from}::text, ${SEARCH_FOLD.to}::text))`;
}

/**
 * The distinct typed words a search applies, each in searchForm's form. EVERY
 * word narrows, as the old in-page filter did (a full bulletin name runs to 15
 * words); the query's own length cap (MAX_SEARCH_LENGTH) is what bounds them.
 */
export function searchWords(query: string): string[] {
  return [...new Set(searchForm(query).split(' ').filter((word) => word !== ''))];
}

/** A word as a LIKE pattern that matches it anywhere, its \, % and _ taken literally. */
const anywhere = (word: string) => `%${word.replace(/[\\%_]/g, (character) => `${BACKSLASH}${character}`)}%`;

/**
 * Every typed word somewhere in `haystack`, in any order; undefined when nothing
 * was typed. One LIKE ALL, so the haystack is folded once per row however many
 * words there are.
 */
export function everyWordSql(haystack: SQLWrapper, query: string): SQL | undefined {
  const words = searchWords(query);
  if (words.length === 0) return undefined;
  const patterns = sql.join(words.map((word) => sql`${anywhere(word)}::text`), sql`, `);
  return sql`${searchFormSql(haystack)} like all (array[${patterns}])`;
}

/** A row's name in the page's language, the other language when that one is blank (nameIn). */
export function nameInSql(nameAr: SQLWrapper, nameEn: SQLWrapper, locale: string): SQL {
  const [first, second] = locale.startsWith('ar') ? [nameAr, nameEn] : [nameEn, nameAr];
  return sql`(case when btrim(coalesce(${first}, ''), ${BLANK}::text) <> '' then ${first} else coalesce(${second}, '') end)`;
}

/** The key a name sorts by in the page's language (see the header for how close it is). */
export function nameSortKeySql(name: SQLWrapper, locale: string): SQL {
  const folded = sql`lower(regexp_replace(normalize(translate(normalize(${name}, NFKC), ${SORT_FOLD.from}::text, ${SORT_FOLD.to}::text), NFKD), ${STRIPPED_MARKS}::text, '', 'g'))`;
  const scripted = locale.startsWith('ar') ? sql`translate(${folded}, ${LATIN}::text, ${LATIN_AFTER_ARABIC}::text)` : folded;
  return sql`regexp_replace(regexp_replace(${scripted}, '([0-9]+)', ${DIGIT_RUN_PADDED}::text, 'g'), '0*([0-9]{10})', ${LAST_TEN_DIGITS}::text, 'g') collate "C"`;
}
