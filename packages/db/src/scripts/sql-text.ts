// SQL prepared for a STATIC READER: comments and string-literal CONTENT removed,
// so a name that only appears in prose or in a message cannot be mistaken for a
// name the statement acts on.
//
// WHY IT EXISTS. Two gates in this package read SQL text rather than a database —
// `migration-catalogue.ts` (does any migration create what the schema declares?)
// and `design-engagement-grant.ts` (what does roles.sql grant, and does anything
// re-widen it?). Both were walked past through the same door in wave 7: a name
// inside a `RAISE NOTICE '…'` satisfied the catalogue's check for an index that
// had just been deleted (F2), `RAISE EXCEPTION '… constraint name(s) …'` put a
// phantom constraint called `name` into the catalogue (F5), and a sentence in a
// roles.sql COMMENT matched the re-widening guard. A reader that cannot tell
// executable text from prose is a reader that can be argued with.
//
// WHAT IS REMOVED:
//   * `--` line comments and `/* … */` block comments (block comments do NOT
//     nest here, unlike Postgres — a nested one leaves a trailing `*/`, which is
//     harmless to every pattern these callers run);
//   * the CONTENT of single-quoted literals, doubled `''` escapes included. The
//     empty `''` is left in place so the statement still parses to the eye and
//     positions stay in order.
//   * the CONTENT of an E-STRING (`E'…'`), where a BACKSLASH escapes the next
//     character. This is its own case because the rules differ: in a plain
//     literal `\'` really does end the string (`standard_conforming_strings` is
//     on), and in an E-string it does not. Reading one with the plain rules ended
//     the literal early, and the trailing real quote then REOPENED a string that
//     swallowed everything up to the next quote or to EOF — so a `DROP INDEX`
//     after an E-string became invisible, which is a false GREEN on the one gate
//     that has no other defence (wave 7 L2). Measured: 0 E-strings in the 54
//     migration files today; this is a fence, not a fix for something live.
//
// WHAT IS KEPT:
//   * double-quoted identifiers, verbatim and with their quotes — they are the
//     only way `"boqs_sourceFile_idx"` survives Postgres's case folding, so a
//     reader that dropped them would lose half the catalogue;
//   * DOLLAR-QUOTED BODIES, which are made TRANSPARENT: the `$$` delimiters are
//     dropped and the body is scanned as SQL. This is deliberate and it is the
//     one judgement call in the file. Migrations 0052 and 0053 are one big
//     `DO $$ … $$` each, and every rename and every `CREATE INDEX` they perform
//     is INSIDE that body; a reader that skipped dollar-quoted bodies would see
//     nothing in either file and the catalogue gate would go green over an empty
//     replay. Every `$…$` in this repository's migrations is a `DO` or function
//     body (measured: 130 occurrences, all bare `$$`), never data. If one is ever
//     used to carry DATA, its content will be read as SQL — that is the limit,
//     and the fix would be to tag it (`$body$`) and teach this scanner the tag.
const DOLLAR_TAG = /^\$[A-Za-z_][\w$]*\$|^\$\$/;

/** SQL with comments and literal content removed; see the header for the rules. */
export function scannableSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += '\n';
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (char === "'") {
      // An `E` immediately before the quote, and not part of a longer word, makes
      // this an E-string: a backslash escapes the character after it.
      const escaping = /[Ee]$/.test(out) && !/[\w$][Ee]$/.test(out);
      let j = i + 1;
      while (j < sql.length) {
        if (escaping && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] !== "'") {
          j += 1;
          continue;
        }
        if (sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        break;
      }
      out += "''";
      i = j + 1;
      continue;
    }
    if (char === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] !== '"') {
          j += 1;
          continue;
        }
        if (sql[j + 1] === '"') {
          j += 2;
          continue;
        }
        break;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (char === '$') {
      const tag = DOLLAR_TAG.exec(sql.slice(i));
      if (tag) {
        // Transparent: the delimiter goes, the body is scanned as SQL.
        out += ' ';
        i += tag[0].length;
        continue;
      }
    }
    out += char;
    i += 1;
  }
  return out;
}
