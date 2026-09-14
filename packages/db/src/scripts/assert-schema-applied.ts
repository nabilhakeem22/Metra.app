// Does the database this URL points at have every column the code expects?
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
// information_schema, and writes nothing.
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { createSql } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import * as schema from '../schema/index';

/** Every table the CODE declares, as table name -> column names. */
function declaredTables(): Map<string, Set<string>> {
  const declared = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    declared.set(config.name, new Set(config.columns.map((column) => column.name)));
  }
  return declared;
}

/** Every table the DATABASE has in `public`, as table name -> column names. */
async function appliedTables(
  sql: ReturnType<typeof createSql>,
): Promise<Map<string, Set<string>>> {
  const rows = (await sql`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
  `) as unknown as Array<{ table_name: string; column_name: string }>;
  const applied = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = applied.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    applied.set(row.table_name, columns);
  }
  return applied;
}

/** One line per thing the code needs and the database does not have. */
function missingFrom(
  declared: Map<string, Set<string>>,
  applied: Map<string, Set<string>>,
): string[] {
  const gaps: string[] = [];
  for (const [table, columns] of declared) {
    const live = applied.get(table);
    if (!live) {
      gaps.push(`  - table ${table} is missing entirely`);
      continue;
    }
    const absent = [...columns].filter((column) => !live.has(column));
    if (absent.length > 0) gaps.push(`  - ${table}: ${absent.join(', ')}`);
  }
  return gaps;
}

async function main() {
  const sql = createSql(MIGRATION_DATABASE_URL(), { max: 1, prepare: false });
  try {
    const declared = declaredTables();
    const gaps = missingFrom(declared, await appliedTables(sql));
    if (gaps.length > 0) {
      console.error(
        'assert-schema-applied: this database is BEHIND the code.\n' +
          `${gaps.join('\n')}\n\n` +
          'Run `npm run migrate -w @metra/db` (then `npm run apply-rls -w @metra/db`) ' +
          'BEFORE shipping this code. Deploying first is not a partial outage: ' +
          "drizzle names every column in its SELECT, so one missing column is 42703 " +
          'for the whole query.',
      );
      process.exit(1);
    }
    console.log(
      `assert-schema-applied: OK — ${declared.size} declared table(s), every column present.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: Error) => {
  console.error('assert-schema-applied failed:', error.message);
  process.exit(1);
});
