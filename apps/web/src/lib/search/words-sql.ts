import 'server-only';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { SEARCH_FOLD, searchForm } from './fold';

// Every typed word, folded, matched anywhere in a row's text, in Postgres: so a
// search costs the Worker one page of rows, whatever the list's size.
//
// SEARCH folds exactly as searchForm (./fold.ts) does, with one known gap:
// searchForm drops EVERY combining mark (\p{Mn}) and format character (\p{Cf});
// Postgres has no \p classes, so STRIPPED_MARKS lists exactly those characters
// in the blocks a studio's text draws on (Latin and its combining accents, Arabic
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

/** One regex class: the marks searchForm drops that a studio's text can hold. Exported for its test. */
export const STRIPPED_MARKS =
  '[\u00ad\u0300-\u036f\u0600-\u0605\u0610-\u061a\u061c\u0640\u064b-\u065f\u0670\u06d6-\u06dd' +
  '\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0890\u0891\u0897-\u089f\u08ca-\u08ff\u1ab0-\u1abd\u1abf-\u1ace\u1dc0-\u1dff' +
  '\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u20d0-\u20dc\u20e1\u20e5-\u20f0' +
  '\ufe00-\ufe0f\ufe20-\ufe2f\ufeff]';

const BACKSLASH = String.fromCharCode(92);

/** `text` in searchForm's form. */
export function searchFormSql(text: SQLWrapper): SQL {
  return sql`lower(translate(regexp_replace(normalize(${text}, NFKC), ${STRIPPED_MARKS}::text, '', 'g'), ${SEARCH_FOLD.from}::text, ${SEARCH_FOLD.to}::text))`;
}

/**
 * The distinct typed words a search applies, each in searchForm's form. EVERY
 * word narrows, as the old in-page filter did (a full bulletin name runs to 15
 * words); each caller's length cap on the query (cleanSearchQuery) is what
 * bounds them.
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
