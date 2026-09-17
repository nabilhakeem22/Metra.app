// Does the database this URL points at have every object the code expects?
//
// THE FAILURE THIS EXISTS TO PREVENT. Deploying code before its migration is not
// a degraded state for the engagement module, it is a TOTAL one: drizzle's
// `select()` emits an explicit column list built from the schema file, so ONE
// missing column makes the whole SELECT fail with 42703 (undefined_column).
// Against a database at 0048, `select()` on engagement_events raises 42703 for
// acknowledged_issue_at and on engagement_transitions for idempotency_key — and
// loadGuardFacts full-row-selects both, so EVERY transition fails, along with the
// timeline, the badge and the corrections path (eight call sites). There is no
// partial degradation to notice: the module simply stops.
//
// deploy.yml cannot run this — it holds no database credential, only
// CLOUDFLARE_API_TOKEN — so this is the OWNER'S pre-merge step, with the exact
// command in docs/DEPLOY.md. Read-only: it opens one connection, reads
// catalogues, and writes nothing.
//
// FOUR KINDS, ONE EXIT CODE — and the exit code is COLUMNS ONLY.
//
//   columns      (gate)          declaredTables()      vs information_schema.columns
//   indexes      (report only)   declaredIndexes()     vs pg_indexes
//   constraints  (report only)   declaredConstraints() vs pg_constraint
//   functions    (report only)   declaredFunctions()   vs pg_proc
//
// The three new sections PRINT and do not gate, deliberately:
//
//   (a) identifier drift is real and already known. 0017 wrote six index names
//       and six constraint names UNQUOTED in camelCase, so Postgres folded them
//       to lower case — in production AND in every fresh CI database built from
//       these migrations. A case-sensitive gate would therefore go red
//       everywhere, over a defect it is merely reporting.
//   (b) this check runs read-only BEFORE `apply-rls` in the deploy order
//       (docs/DEPLOY.md), so a function-name gate would refuse to start on any
//       function that the pending apply-rls run is about to create.
//
// For the same reason it is NOT a CI step: CI's fresh database is built from the
// same migrations and would show the same folded names.
//
// ALL FOUR SECTIONS PRINT ON THE FAILING RUN. The exit code is columns only,
// but the three report-only catalogues are what tell the owner what ELSE is out
// of step, and that run is the one whose output gets pasted into an incident.
// The previous version computed them and then exited before printing them.
//
// What the code declares, and how a name is compared, lives in
// `schema-catalogue.ts` — which has no connection and is unit-tested. The four
// reads and the report they print live in `schema-check.ts`, which takes the
// handle as an argument and returns the exit code — so this file is only the
// wiring: open a connection, run it, close it, exit.
import { createSql } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { runSchemaCheck } from './schema-check';

async function main(): Promise<number> {
  const sql = createSql(MIGRATION_DATABASE_URL(), { max: 1, prepare: false });
  try {
    return await runSchemaCheck(sql);
  } finally {
    await sql.end();
  }
}

// `process.exitCode`, not `process.exit()`: the latter tears the process down
// where it stands, which on a failing run is exactly when there is the most
// buffered output to lose. Nothing here keeps the loop alive once `sql.end()`
// has resolved.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: Error) => {
    console.error('assert-schema-applied failed:', error.message);
    process.exitCode = 1;
  });
