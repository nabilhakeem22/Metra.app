import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `ALTER TYPE ... ADD VALUE` AND THE MIGRATOR'S ONE TRANSACTION.
//
// drizzle's migrator applies EVERY pending migration inside ONE transaction, and
// a fresh database (CI, a rebuilt environment) replays the WHOLE folder in that
// one transaction. PostgreSQL 12+ accepts ADD VALUE inside a transaction block
// but refuses to USE the new label before the transaction commits (55P04,
// "unsafe use of new value"); PL/pgSQL refuses ADD VALUE altogether. So two rules
// keep every ADD VALUE in this folder applicable, and neither shows up on a
// warm database where the migration ran alone:
//
//   1. it is a TOP-LEVEL statement, never inside a `DO $$ ... $$` body;
//   2. its label is never named again: not later in its own file and not in any
//      LATER migration, because on a fresh replay those run in the same
//      transaction. The first use of a new label is application code.
//
// Comments are stripped before reading, so a label in prose is not a use. Two
// mentions are not uses either, and are removed before the search: another
// type's `CREATE TYPE ... AS ENUM (...)` list (0061's market_unit shares labels
// with cost_item_unit), and a comparison of the column CAST TO TEXT
// (`kind::text = 'event_correction'`, 0043's deliberate way round the rule).

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const migrationsFolder = resolve(here, '../../migrations');
const journal: { entries: Array<{ tag: string }> } = JSON.parse(
  readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
);

const ADD_VALUE = /alter\s+type\s+([\w."]+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi;

/** The executable text: `--` line comments and block comments removed. */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const OTHER_ENUM_DEFINITION = /create\s+type\s+[\w."]+\s+as\s+enum\s*\([^)]*\)/gi;
const TEXT_COMPARISON = /::text\s*(=|<>|!=)\s*'[^']*'/gi;

/** The text a label could be USED in: no enum definitions, no text comparisons. */
function enumUses(sql: string): string {
  return sql.replace(OTHER_ENUM_DEFINITION, '').replace(TEXT_COMPARISON, '');
}

interface AddedValue {
  tag: string;
  type: string;
  label: string;
  /** Character offset of the ADD VALUE statement in the comment-free text. */
  at: number;
}

const files = journal.entries.map(({ tag }) => ({
  tag,
  sql: withoutComments(readFileSync(resolve(migrationsFolder, `${tag}.sql`), 'utf8')),
}));

const added: AddedValue[] = files.flatMap(({ tag, sql }) =>
  [...sql.matchAll(ADD_VALUE)].map((match) => ({ tag, type: match[1], label: match[2], at: match.index ?? 0 })),
);

describe('ALTER TYPE ... ADD VALUE in the migrations folder', () => {
  it('finds the ADD VALUEs it is meant to be checking', () => {
    // A guard on the guard: 0061 alone adds five.
    expect(added.filter((value) => value.tag === '0061_market_price_book').map((value) => value.label)).toEqual([
      'kg', 'ton', 'liter', 'cbm', 'roll',
    ]);
    expect(added.length).toBeGreaterThan(10);
  });

  it('never sits inside a DO $$ block', () => {
    const nested = added.filter(({ tag, at }) => {
      const before = files.find((file) => file.tag === tag)?.sql.slice(0, at) ?? '';
      return (before.match(/\$\$/g) ?? []).length % 2 === 1;
    });
    expect(nested.map(({ tag, label }) => `${tag}: '${label}'`)).toEqual([]);
  });

  it('never names a new label again, in its own file or any later one', () => {
    const uses: string[] = [];
    for (const value of added) {
      const index = files.findIndex((file) => file.tag === value.tag);
      const own = files[index].sql;
      const statementEnd = own.indexOf(';', value.at);
      const rest = enumUses([own.slice(statementEnd + 1), ...files.slice(index + 1).map((file) => file.sql)].join('\n'));
      if (rest.includes(`'${value.label}'`)) uses.push(`${value.tag}: '${value.label}' (${value.type}) is named again`);
    }
    expect(uses).toEqual([]);
  });
});
