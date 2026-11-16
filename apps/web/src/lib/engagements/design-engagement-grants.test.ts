import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designEngagements } from '@metra/db';
import { describe, expect, it } from 'vitest';
import {
  DESIGN_ENGAGEMENTS_TABLE,
  grantedUpdateColumnsOf,
  tableLevelUpdateGrantsOf,
  updateRevokesOf,
} from '../../../../../packages/db/src/scripts/column-update-grant';
import { updateWriteSites } from '@/test/column-writes/write-sites';
import { columnWriteTarget } from '@/test/column-writes/write-target';

// THE GRANT AND THE CODE, KEPT HONEST BY A MACHINE.
//
// `rls/roles.sql` grants metra_app a COLUMN-LEVEL update on
// `design_engagements`: nineteen derived columns and nothing else, so the client,
// the project, the number, `created_at` and (the ones that matter) the two
// free-revision ALLOWANCES cannot be moved by any future code path or by SQL
// injected past the ORM.
//
// A hand-maintained column list against a growing set of update sites is an
// outage with a fuse on it: add a column to a `.set({…})`, deploy, and the write
// fails with 42501 in production, not in review. So the list is not trusted:
// it is DERIVED here, from the source, and compared. If they diverge this test
// prints both directions of the diff, and the fix is one line in roles.sql or
// one column removed from a core.
//
// THE SCAN ITSELF lives in `src/test/column-writes/` since security batch 3,
// which narrowed two more tables the same way (`lib/db/narrowed-update-grants.test.ts`).
// Why it is a source parse and not a runtime probe, why the TypeScript AST and
// not a string search, what it refuses to guess (a spread or computed key in a
// `set`, an `.update(…)` it cannot resolve to a table, a `set` not produced by a
// helper annotated `PgUpdateSetSource<typeof designEngagements>`, raw SQL that
// writes the table) and which trees it reads are written there, beside the code.
// `revisions.ts` writes through `REVISION_COUNTERS[trigger].increment(now)`, a
// factory whose two columns no grep for `.set({` can see; the annotation is what
// makes it readable.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/engagements
const ROLES_SQL = resolve(here, '../../../../../packages/db/src/rls/roles.sql');

const grantedUpdateColumns = (rolesSql: string) => grantedUpdateColumnsOf(rolesSql, DESIGN_ENGAGEMENTS_TABLE);
const tableLevelUpdateGrants = (rolesSql: string) => tableLevelUpdateGrantsOf(rolesSql, DESIGN_ENGAGEMENTS_TABLE);
const updateRevokes = (rolesSql: string) => updateRevokesOf(rolesSql, DESIGN_ENGAGEMENTS_TABLE);

/**
 * Columns roles.sql grants BEFORE any app code writes them, because the owner's
 * one database step must cover the code that follows it. Empty while every
 * granted column has a writer: Round C's three expected-date columns (0058)
 * left it when `lib/engagements/client-expected.ts` began writing them. A
 * future database step that lands ahead of its code lists its columns here,
 * and the test below makes the writer remove them.
 */
const GRANTED_AHEAD_OF_WRITER: readonly string[] = [];

const target = columnWriteTarget('designEngagements', designEngagements);
const sites = updateWriteSites(target);

describe('design_engagements column grants match what the app writes', () => {
  it('finds the update sites it is meant to be checking', () => {
    // A guard on the guard: a rename of `designEngagements` or a move of the
    // source root would otherwise make every assertion below pass vacuously.
    expect(sites.length).toBeGreaterThanOrEqual(13);
  });

  it('grants exactly the columns the update sites write — no more, no fewer', () => {
    const written = new Set(sites.flatMap((site) => site.columns));
    const granted = new Set(grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')));
    const missing = [...written].filter((column) => !granted.has(column)).sort();
    const surplus = [...granted]
      .filter((column) => !written.has(column) && !GRANTED_AHEAD_OF_WRITER.includes(column))
      .sort();

    // Reported as two named lists rather than a set comparison: which DIRECTION
    // it drifted is the whole diagnosis. `missing` is a 42501 waiting to happen;
    // `surplus` is authority nothing uses.
    expect({ missing, surplus }).toEqual({ missing: [], surplus: [] });
    expect(granted.size).toBe(19);
  });

  it('lists a column as granted ahead only while it is granted and has no writer yet', () => {
    // The exemption above is for a database step that lands BEFORE the code it
    // serves (Round C: 0058 grants the expected-date pair, its writer arrives
    // in Wave 3). The moment a writer exists the entry must go, so the list
    // cannot quietly outlive its reason.
    const written = new Set(sites.flatMap((site) => site.columns));
    const granted = new Set(grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')));
    expect(GRANTED_AHEAD_OF_WRITER.filter((column) => written.has(column))).toEqual([]);
    expect(GRANTED_AHEAD_OF_WRITER.filter((column) => !granted.has(column))).toEqual([]);
  });

  it('keeps the table-level UPDATE revoked, so the column list is not cosmetic', () => {
    // A table-level UPDATE subsumes every column grant, so a re-widening would
    // leave the list above passing while granting the whole row. Both readings
    // live in `column-update-grant.ts`, which the database-side gate shares,
    // and both are asked of comment-free text.
    const text = readFileSync(ROLES_SQL, 'utf8');
    expect(tableLevelUpdateGrants(text)).toEqual([]);

    // EVERY revoke must come before the column grant, not just the first one:
    // revoking the table-level privilege takes the column grants with it, so one
    // appended below the grant leaves metra_app with no UPDATE at all.
    const revokes = updateRevokes(text);
    expect(revokes.after).toEqual([]);
    expect(revokes.before).toEqual([
      'revoke update on public.design_engagements from metra_app;',
    ]);
  });

  it('never grants a column the schema does not have', () => {
    const unknown = grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')).filter(
      (column) => ![...target.columnOf.values()].includes(column),
    );
    expect(unknown).toEqual([]);
  });
});
