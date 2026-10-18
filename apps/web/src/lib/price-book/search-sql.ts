import 'server-only';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { STRIPPED_MARKS } from '@/lib/search/words-sql';

// The price book searched and ordered BY NAME in Postgres, so a page of a
// 2,000-item book costs the Worker one page of rows, not the whole book.
//
// ORDER follows Intl.Collator(locale, { numeric: true, sensitivity: 'base' }),
// which the page used to sort with, under the "C" collation, so the order is the
// same on every server and needs no ICU collation: hamza carriers sort as alef,
// ة beside ت, accents ignored, digit runs compared as numbers, and (in Arabic)
// Arabic script before Latin. Measured on the July 2026 bulletin's 447 names: 23
// of 113,526 pairs differ in Arabic and 3 in English, every one a tie or a
// punctuation mark («°» against «،»).

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
