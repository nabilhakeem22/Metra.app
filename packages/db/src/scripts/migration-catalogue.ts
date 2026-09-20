// What the MIGRATIONS build, replayed from their text. No database, no socket.
//
// `schema-catalogue.ts` answers "what does the code DECLARE"; `assert-schema-applied`
// answers "what does this database HOLD" and needs a connection, is not a CI step,
// and is therefore run by a human once per deploy at best. Between the two sat the
// question nobody could ask cheaply: **does any migration actually create the thing
// the schema declares?** Two indexes on `boqs` were declared for a whole wave with
// no migration behind them, and the only reason anyone found out was a manual run
// against production.
//
// This module answers it from the text alone, so `migration-catalogue.test.ts` can
// fail on a fresh clone in milliseconds - before CI, before a deploy, before a
// production read.
//
// IT IS A REPLAY, NOT A PARSER. Statements are applied in TEXTUAL ORDER, because
// order is load-bearing: 0006 and 0049 both DROP an index and CREATE it again in
// the same file, and a reader that did all the creates and then all the drops would
// conclude the index does not exist.
//
// KNOWN LIMITS, stated rather than discovered later:
//   * DYNAMIC SQL IS INVISIBLE. `EXECUTE format('ALTER TABLE %I …')` carries no
//     identifier to read, so an object created or renamed that way is not seen. This
//     is why 0053 spells its sixteen renames as sixteen literal statements: the loop
//     that wrote them was shorter and would have defeated this check silently.
//     0052's dynamic DROP + ADD of the same twelve constraint names is a no-op here,
//     which is correct - the names do not change.
//   * IMPLICIT NAMES ARE NOT INVENTED. A `unique (a, b)` with no CONSTRAINT clause,
//     or a primary key's `<table>_pkey`, is named by Postgres and never appears in
//     the text. `declaredConstraints()` only returns NAMED checks, uniques and
//     foreign keys, so the comparison stays honest.
//   * ONE-DIRECTIONAL. Extra objects a migration creates and the schema does not
//     declare are legitimate (partial indexes, operational indexes) and never
//     reported.
//   * PROSE IS NOT SQL, and this is the limit that was WRONG here until wave 7's
//     loop 1. The text is run through `sql-text.ts` first, which removes comments
//     AND the content of single-quoted literals, so an object named inside a
//     `RAISE NOTICE '…'` neither enters the catalogue nor leaves it. Both
//     directions were live: `RAISE EXCEPTION '0053: constraint name(s) not
//     renamed: %'` put a phantom constraint called `name` in (F5), and a name
//     mentioned in a NOTICE satisfied the check for an index whose CREATE had
//     been deleted (F2). Dollar-quoted bodies are TRANSPARENT rather than
//     stripped — 0052 and 0053 are one `DO $$ … $$` each and every statement they
//     run is inside one, so a reader that skipped those bodies would replay
//     nothing and report green. The previous note here claimed string and
//     dollar-quoted bodies were "copied through the comment stripper verbatim";
//     the first half was true and is now deliberately false, and the second half
//     never was (F6).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scannableSql } from './sql-text';

interface JournalEntry {
  idx: number;
  tag: string;
}

export interface MigrationCatalogue {
  indexes: Set<string>;
  constraints: Set<string>;
}

/** An identifier: `"KeptAsIs"` or `folded_to_lower`, as Postgres resolves it. */
const IDENTIFIER = String.raw`(?:"([^"]+)"|([A-Za-z_][\w$]*))`;

const CREATE_INDEX = new RegExp(
  String.raw`create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${IDENTIFIER}\s+on\b`,
  'gi',
);
const DROP_INDEX = new RegExp(
  String.raw`drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?:public\.)?${IDENTIFIER}`,
  'gi',
);
const RENAME_INDEX = new RegExp(
  String.raw`alter\s+index\s+(?:if\s+exists\s+)?(?:public\.)?${IDENTIFIER}\s+rename\s+to\s+${IDENTIFIER}`,
  'gi',
);
const RENAME_CONSTRAINT = new RegExp(
  String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?${IDENTIFIER}\s+rename\s+constraint\s+${IDENTIFIER}\s+to\s+${IDENTIFIER}`,
  'gi',
);
// `add constraint x`, `drop constraint x`, and the bare `constraint x` of a CREATE
// TABLE body. `rename` is captured only so it can be SKIPPED - RENAME_CONSTRAINT
// above already handles it, and letting this pattern read the old name as an `add`
// would resurrect the very name the rename removed.
const CONSTRAINT = new RegExp(
  String.raw`(?:\b(add|drop|rename)\s+)?\bconstraint\s+(?:if\s+exists\s+)?${IDENTIFIER}`,
  'gi',
);

/** Postgres folds an UNQUOTED identifier to lower case; a quoted one is literal. */
function identifierAt(match: RegExpMatchArray, quoted: number): string | null {
  const literal = match[quoted];
  if (literal !== undefined) return literal;
  const bare = match[quoted + 1];
  return bare === undefined ? null : bare.toLowerCase();
}

type Step = { at: number; apply: (catalogue: MigrationCatalogue) => void };

function stepsIn(text: string): Step[] {
  const steps: Step[] = [];
  const add = (at: number, apply: Step['apply']) => steps.push({ at, apply });

  for (const match of text.matchAll(CREATE_INDEX)) {
    const name = identifierAt(match, 1);
    if (name) add(match.index, (c) => c.indexes.add(name));
  }
  for (const match of text.matchAll(DROP_INDEX)) {
    const name = identifierAt(match, 1);
    if (name) add(match.index, (c) => c.indexes.delete(name));
  }
  for (const match of text.matchAll(RENAME_INDEX)) {
    const from = identifierAt(match, 1);
    const to = identifierAt(match, 3);
    if (from && to) {
      add(match.index, (c) => {
        c.indexes.delete(from);
        c.indexes.add(to);
      });
    }
  }
  for (const match of text.matchAll(RENAME_CONSTRAINT)) {
    const from = identifierAt(match, 3);
    const to = identifierAt(match, 5);
    if (from && to) {
      add(match.index, (c) => {
        c.constraints.delete(from);
        c.constraints.add(to);
      });
    }
  }
  for (const match of text.matchAll(CONSTRAINT)) {
    const verb = match[1]?.toLowerCase();
    const name = identifierAt(match, 2);
    if (!name || verb === 'rename') continue;
    if (verb === 'drop') add(match.index, (c) => c.constraints.delete(name));
    else add(match.index, (c) => c.constraints.add(name));
  }

  return steps.sort((a, b) => a.at - b.at);
}

/** Replay every migration the journal lists, in journal order. */
export function migrationCatalogue(migrationsFolder: string): MigrationCatalogue {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  const catalogue: MigrationCatalogue = { indexes: new Set(), constraints: new Set() };
  for (const entry of journal.entries) {
    const text = scannableSql(
      readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), 'utf8'),
    );
    for (const step of stepsIn(text)) step.apply(catalogue);
  }
  return catalogue;
}
