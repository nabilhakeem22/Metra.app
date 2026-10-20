// comparisonForm (./compare.ts) as a Postgres expression, so a typed name is
// compared with every name a studio holds IN THE DATABASE, and the Worker
// receives one row however large the price book is (the add's name-clash check,
// apps/web market-item-reads.ts).
//
// Step by step as comparisonForm: NFKC; delete every format character (Cf),
// non-spacing mark (Mn) and tatweel; fold Persian yeh and kaf, the alef forms,
// ta marbuta, alef maqsura and both Arabic-Indic digit sets; one space for
// every whitespace run JS `\s` matches; trim; lower case. Postgres has no \p
// classes, so the deleted characters are listed (compare-sql.test.ts proves the
// list is exactly the runtime's \p{Mn}, \p{Cf} and tatweel). lower() follows the
// database's ctype ("C" lowers ASCII only), so it is used under "C" for ASCII
// alone, and every other case pair comes from a translate() table read off
// THIS runtime's toLowerCase, so the SQL lowers as the JS it stands beside.
//
// ONE known difference, and it is on the safe side: toLowerCase writes a capital
// sigma at the end of a word as ς, and the table always writes σ, so ς is folded
// to σ as well. A name comparisonForm reads alike still reads alike here; Greek
// words differing only in final sigma also read alike here (never a missed
// clash, at worst an extra one). Node and Postgres may run different Unicode
// versions, which matters only for characters assigned in the newer one.
import { sql, type SQL } from 'drizzle-orm';

/** Every character comparisonForm deletes (\p{Cf}, \p{Mn}, tatweel), as hex code point ranges. */
export const DELETED_RANGES = (
  '00ad 0300-036f 0483-0487 0591-05bd 05bf 05c1-05c2 05c4-05c5 05c7 0600-0605 0610-061a 061c 0640 064b-065f 0670 ' +
  '06d6-06dd 06df-06e4 06e7-06e8 06ea-06ed 070f 0711 0730-074a 07a6-07b0 07eb-07f3 07fd 0816-0819 081b-0823 ' +
  '0825-0827 0829-082d 0859-085b 0890-0891 0897-089f 08ca-0902 093a 093c 0941-0948 094d 0951-0957 0962-0963 0981 ' +
  '09bc 09c1-09c4 09cd 09e2-09e3 09fe 0a01-0a02 0a3c 0a41-0a42 0a47-0a48 0a4b-0a4d 0a51 0a70-0a71 0a75 0a81-0a82 ' +
  '0abc 0ac1-0ac5 0ac7-0ac8 0acd 0ae2-0ae3 0afa-0aff 0b01 0b3c 0b3f 0b41-0b44 0b4d 0b55-0b56 0b62-0b63 0b82 0bc0 ' +
  '0bcd 0c00 0c04 0c3c 0c3e-0c40 0c46-0c48 0c4a-0c4d 0c55-0c56 0c62-0c63 0c81 0cbc 0cbf 0cc6 0ccc-0ccd 0ce2-0ce3 ' +
  '0d00-0d01 0d3b-0d3c 0d41-0d44 0d4d 0d62-0d63 0d81 0dca 0dd2-0dd4 0dd6 0e31 0e34-0e3a 0e47-0e4e 0eb1 0eb4-0ebc ' +
  '0ec8-0ece 0f18-0f19 0f35 0f37 0f39 0f71-0f7e 0f80-0f84 0f86-0f87 0f8d-0f97 0f99-0fbc 0fc6 102d-1030 1032-1037 ' +
  '1039-103a 103d-103e 1058-1059 105e-1060 1071-1074 1082 1085-1086 108d 109d 135d-135f 1712-1714 1732-1733 ' +
  '1752-1753 1772-1773 17b4-17b5 17b7-17bd 17c6 17c9-17d3 17dd 180b-180f 1885-1886 18a9 1920-1922 1927-1928 1932 ' +
  '1939-193b 1a17-1a18 1a1b 1a56 1a58-1a5e 1a60 1a62 1a65-1a6c 1a73-1a7c 1a7f 1ab0-1abd 1abf-1ace 1b00-1b03 1b34 ' +
  '1b36-1b3a 1b3c 1b42 1b6b-1b73 1b80-1b81 1ba2-1ba5 1ba8-1ba9 1bab-1bad 1be6 1be8-1be9 1bed 1bef-1bf1 1c2c-1c33 ' +
  '1c36-1c37 1cd0-1cd2 1cd4-1ce0 1ce2-1ce8 1ced 1cf4 1cf8-1cf9 1dc0-1dff 200b-200f 202a-202e 2060-2064 2066-206f ' +
  '20d0-20dc 20e1 20e5-20f0 2cef-2cf1 2d7f 2de0-2dff 302a-302d 3099-309a a66f a674-a67d a69e-a69f a6f0-a6f1 a802 ' +
  'a806 a80b a825-a826 a82c a8c4-a8c5 a8e0-a8f1 a8ff a926-a92d a947-a951 a980-a982 a9b3 a9b6-a9b9 a9bc-a9bd a9e5 ' +
  'aa29-aa2e aa31-aa32 aa35-aa36 aa43 aa4c aa7c aab0 aab2-aab4 aab7-aab8 aabe-aabf aac1 aaec-aaed aaf6 abe5 abe8 ' +
  'abed fb1e fe00-fe0f fe20-fe2f feff fff9-fffb 101fd 102e0 10376-1037a 10a01-10a03 10a05-10a06 10a0c-10a0f ' +
  '10a38-10a3a 10a3f 10ae5-10ae6 10d24-10d27 10d69-10d6d 10eab-10eac 10efc-10eff 10f46-10f50 10f82-10f85 11001 ' +
  '11038-11046 11070 11073-11074 1107f-11081 110b3-110b6 110b9-110ba 110bd 110c2 110cd 11100-11102 11127-1112b ' +
  '1112d-11134 11173 11180-11181 111b6-111be 111c9-111cc 111cf 1122f-11231 11234 11236-11237 1123e 11241 112df ' +
  '112e3-112ea 11300-11301 1133b-1133c 11340 11366-1136c 11370-11374 113bb-113c0 113ce 113d0 113d2 113e1-113e2 ' +
  '11438-1143f 11442-11444 11446 1145e 114b3-114b8 114ba 114bf-114c0 114c2-114c3 115b2-115b5 115bc-115bd ' +
  '115bf-115c0 115dc-115dd 11633-1163a 1163d 1163f-11640 116ab 116ad 116b0-116b5 116b7 1171d 1171f 11722-11725 ' +
  '11727-1172b 1182f-11837 11839-1183a 1193b-1193c 1193e 11943 119d4-119d7 119da-119db 119e0 11a01-11a0a ' +
  '11a33-11a38 11a3b-11a3e 11a47 11a51-11a56 11a59-11a5b 11a8a-11a96 11a98-11a99 11c30-11c36 11c38-11c3d 11c3f ' +
  '11c92-11ca7 11caa-11cb0 11cb2-11cb3 11cb5-11cb6 11d31-11d36 11d3a 11d3c-11d3d 11d3f-11d45 11d47 11d90-11d91 ' +
  '11d95 11d97 11ef3-11ef4 11f00-11f01 11f36-11f3a 11f40 11f42 11f5a 13430-13440 13447-13455 1611e-16129 ' +
  '1612d-1612f 16af0-16af4 16b30-16b36 16f4f 16f8f-16f92 16fe4 1bc9d-1bc9e 1bca0-1bca3 1cf00-1cf2d 1cf30-1cf46 ' +
  '1d167-1d169 1d173-1d182 1d185-1d18b 1d1aa-1d1ad 1d242-1d244 1da00-1da36 1da3b-1da6c 1da75 1da84 1da9b-1da9f ' +
  '1daa1-1daaf 1e000-1e006 1e008-1e018 1e01b-1e021 1e023-1e024 1e026-1e02a 1e08f 1e130-1e136 1e2ae 1e2ec-1e2ef ' +
  '1e4ec-1e4ef 1e5ee-1e5ef 1e8d0-1e8d6 1e944-1e94a e0001 e0020-e007f e0100-e01ef '
).trim().split(' ');

/** The blocks holding every character toLowerCase changes outside ASCII (with some it keeps): where the case table is read from. */
export const CASED_RANGES = (
  '00c0-00de 0100-024e 0370-0376 037f-03ab 03cf 03d8-042f 0460-0480 048a-0556 10a0-10cd 13a0-13f5 1c89-1cbf ' +
  '1e00-1e94 1e9e-1efe 1f08-1f0f 1f18-1f1d 1f28-1f2f 1f38-1f3f 1f48-1f4d 1f59-1f5f 1f68-1f6f 1f88-1f8f 1f98-1f9f ' +
  '1fa8-1faf 1fb8-1fbc 1fc8-1fcc 1fd8-1fdb 1fe8-1fec 1ff8-1ffc 2126-2132 2160-216f 2183 24b6-24cf 2c00-2c2f ' +
  '2c60-2c75 2c7e-2ce2 2ceb-2cf2 a640-a66c a680-a69a a722-a76e a779-a7dc a7f5 ff21-ff3a 10400-10427 104b0-104d3 ' +
  '10570-10595 10c80-10cb2 10d50-10d65 118a0-118bf 16e40-16e5f 1e900-1e921'
).split(' ');

/** The letters comparisonForm folds, `from[i]` to `to[i]`: Persian yeh and kaf, the alef forms, ta marbuta, alef maqsura. */
const LETTERS = { from: '\u06cc\u06a9\u0623\u0625\u0622\u0629\u0649', to: '\u064a\u0643\u0627\u0627\u0627\u0647\u064a' };
/** Both Arabic-Indic digit sets, as Western digits. */
const DIGITS = {
  from: '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9',
  to: '01234567890123456789',
};
/** What JS `\s` matches (and trim() removes) besides the space itself, as one regex class body. */
const OTHER_SPACES = '\t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
/** The one capital toLowerCase writes as TWO characters: i and a combining dot above. */
const DOTTED_CAPITAL_I = { from: '\u0130', to: 'i\u0307' };
const SIGMA = { final: '\u03c2', medial: '\u03c3' };

const character = (hex: string) => String.fromCodePoint(Number.parseInt(hex, 16));

/** `0300-036f` -> its two characters joined by '-', a lone code point as itself: one regex class body. */
function classBody(ranges: string[]): string {
  return ranges.map((range) => range.split('-').map(character).join('-')).join('');
}

function* codePointsOf(ranges: string[]): Generator<number> {
  for (const range of ranges) {
    const [start, end = start] = range.split('-').map((hex) => Number.parseInt(hex, 16));
    for (let point = start; point <= end; point += 1) yield point;
  }
}

export interface CaseTable {
  from: string;
  to: string;
}

/** Each character in CASED_RANGES that toLowerCase turns into ONE other character, and ς as σ. */
export function caseTable(): CaseTable {
  const table: CaseTable = { from: SIGMA.final, to: SIGMA.medial };
  for (const point of codePointsOf(CASED_RANGES)) {
    const capital = String.fromCodePoint(point);
    const lower = capital.toLowerCase();
    if (lower === capital || [...lower].length !== 1) continue;
    table.from += capital;
    table.to += lower;
  }
  return table;
}

let rules: SQL | undefined;

/**
 * The WITH entry every comparisonFormSql reads its tables from, bound ONCE per
 * statement (they run to a few kilobytes); read through uncorrelated
 * subqueries, so Postgres evaluates each once.
 */
export function comparisonRulesSql(): SQL {
  if (rules) return rules;
  const cased = caseTable();
  rules = sql`comparison_rules as (
    select ${`[${classBody(DELETED_RANGES)}]`}::text as deleted, ${LETTERS.from}::text as letters_from, ${LETTERS.to}::text as letters_to,
           ${`[${DIGITS.from}]`}::text as digits, ${DIGITS.from}::text as digits_from, ${DIGITS.to}::text as digits_to,
           ${`[${OTHER_SPACES}]|  |^ | $`}::text as uneven_spaces, ${`[ ${OTHER_SPACES}]+`}::text as spaces,
           ${`[${classBody(CASED_RANGES)}${SIGMA.final}]`}::text as cased, ${DOTTED_CAPITAL_I.from}::text as dotted_from,
           ${DOTTED_CAPITAL_I.to}::text as dotted_to, ${cased.from}::text as case_from, ${cased.to}::text as case_to)`;
  return rules;
}

const rule = (name: string) => sql.raw(`(select ${name} from comparison_rules)`);

/**
 * `value`, computed ONCE, as `step` reads it: a step that tests its input
 * before changing it would otherwise compute that input twice, since Postgres
 * inlines a plain subquery wherever its output is used (OFFSET 0 stops that).
 */
function once(value: SQL, step: (input: SQL) => SQL): SQL {
  return sql`(select ${step(sql.raw('v.value'))} from (select ${value} as value offset 0) v)`;
}

/**
 * `text` in comparisonForm's form (null stays null); the statement's WITH must
 * hold comparisonRulesSql(). A step that rarely changes a name runs only when
 * a test says it would: most names are NFKC already and hold no Arabic-Indic
 * digit, no uneven space and no capital outside ASCII.
 */
export function comparisonFormSql(text: SQL): SQL {
  const composed = once(text, (input) => sql`case when ${input} is nfkc normalized then ${input} else normalize(${input}, NFKC) end`);
  const lettered = sql`translate(regexp_replace(${composed}, ${rule('deleted')}, '', 'g'), ${rule('letters_from')}, ${rule('letters_to')})`;
  const digits = once(lettered, (input) => sql`case when ${input} ~ ${rule('digits')} then translate(${input}, ${rule('digits_from')}, ${rule('digits_to')}) else ${input} end`);
  const spaced = once(digits, (input) =>
    sql`case when ${input} ~ ${rule('uneven_spaces')} then btrim(regexp_replace(${input}, ${rule('spaces')}, ' ', 'g'), ' ') else ${input} end`);
  return once(spaced, (input) => sql`lower((case when ${input} ~ ${rule('cased')}
      then translate(replace(${input}, ${rule('dotted_from')}, ${rule('dotted_to')}), ${rule('case_from')}, ${rule('case_to')})
      else ${input} end) collate "C")`);
}
