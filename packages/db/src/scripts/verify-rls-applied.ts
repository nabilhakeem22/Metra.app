// Did `apply-rls` actually LAND? Read back from the catalogues, on the same
// connection, right after the loop.
//
// THE GAP THIS CLOSES. `apply-rls` printed `Applying <file> ...` per file and
// `RLS, roles and functions applied.` at the end - that was the entire
// post-condition. The only structural guard was
// `rls/functions-order.test.ts`'s manifest-coverage case, which proves a file is
// LISTED, not that its objects exist in the database. The failure shape it
// misses is D7's: a `.sql` file that is never applied, silently, with the
// symptom turning up somewhere else entirely.
//
// AND THE LIST IS NOW FIFTEEN FILES, NOT FOUR. Each file is one implicit
// transaction (postgres.js sends it over the simple protocol), so each is atomic
// on its own - but the SEQUENCE is not. `roles.sql` is file 9 and issues all 77
// grants to `metra_app`; the six policy files that enable/force RLS and create
// the 46 policies run AFTER it. A failure between them leaves the next NEW table
// granted to `metra_app` with no RLS and no policy. There are six stop points in
// the policy half now where there used to be one.
//
// WHAT IS CHECKED, and deliberately what is not:
//
//   * every table in the DRIZZLE SCHEMA has relrowsecurity AND
//     relforcerowsecurity - the tenancy invariant itself;
//   * every `create policy` in the manifest files exists in `pg_policies` - the
//     load-bearing one, because it is what catches a file that never ran;
//   * every `create trigger` exists in `pg_trigger` (non-internal);
//   * every function the manifest defines exists in `pg_proc`;
//   * the `metra_app` role exists, and is neither LOGIN nor BYPASSRLS;
//   * `design_engagements` has NO table-level UPDATE for metra_app, and its
//     column-level UPDATE names EXACTLY the columns roles.sql grants. Wave 7
//     narrowed that authority to fifteen derived columns so that a free-revision
//     allowance, a client or a project cannot be moved by any code path; until
//     wave 7's loop 1 the only thing that checked it was a static text parse of
//     roles.sql, and this line — "verified in the catalogues … role metra_app
//     present" — was printed whether the grant was fifteen columns or the whole
//     row (S4). A table-level UPDATE subsumes every column grant, so BOTH halves
//     are needed: the absence of the table privilege is what makes the column
//     list mean anything.
//
// NOT indexes and NOT constraints: those carry the known case-fold drift from
// 0017 (twelve names Postgres folded because they were written unquoted), and a
// case-sensitive gate on them would be red on every database including a fresh
// CI one. That is `assert-schema-applied`'s report-only territory and stays
// there.
//
// ONE-DIRECTIONAL, like `schema-catalogue.ts`: an EXTRA policy, trigger or
// function in the database is never reported. Only "the code declares it and the
// database does not have it".
//
// Function names are compared WITHOUT their argument lists, which is the one
// hole worth stating: an overload change (`app_claim_invitation(uuid)` ->
// `(text)`) reads green here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { createSql } from '../client';
import { GRANTED_UPDATE_TABLE, grantedUpdateColumns } from './design-engagement-grant';
import { declaredFunctions, declaredPolicies, declaredTriggers } from './rls-catalogue';
import { declaredTables } from './schema-catalogue';

type Sql = ReturnType<typeof createSql>;

/** The role every org-scoped query runs as. NOLOGIN, NOBYPASSRLS, by design. */
const APP_ROLE = 'metra_app';

async function rlsFlags(sql: Sql): Promise<Map<string, { enabled: boolean; forced: boolean }>> {
  const rows = (await sql`
    select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  `) as unknown as Array<{ name: string; enabled: boolean; forced: boolean }>;
  return new Map(rows.map((row) => [row.name, { enabled: row.enabled, forced: row.forced }]));
}

async function appliedPolicies(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select tablename, policyname from pg_policies where schemaname = 'public'
  `) as unknown as Array<{ tablename: string; policyname: string }>;
  return new Set(rows.map((row) => `${row.tablename}.${row.policyname}`));
}

async function appliedTriggers(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select c.relname as tablename, t.tgname as triggername
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  `) as unknown as Array<{ tablename: string; triggername: string }>;
  return new Set(rows.map((row) => `${row.tablename}.${row.triggername}`));
}

async function appliedFunctions(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    select p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  `) as unknown as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

async function appRoleProblems(sql: Sql): Promise<string[]> {
  const rows = (await sql`
    select rolcanlogin as "canLogin", rolbypassrls as "bypassRls"
      from pg_roles where rolname = ${APP_ROLE}
  `) as unknown as Array<{ canLogin: boolean; bypassRls: boolean }>;
  if (rows.length === 0) {
    return [`  - role ${APP_ROLE} does not exist — roles.sql did not run`];
  }
  const [role] = rows;
  if (role.canLogin || role.bypassRls) {
    return [
      `  - role ${APP_ROLE} is too strong: canlogin=${String(role.canLogin)} ` +
        `bypassrls=${String(role.bypassRls)} — it must be neither`,
    ];
  }
  return [];
}

const ROLES_SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../rls/roles.sql');

/**
 * The `design_engagements` UPDATE authority, compared against roles.sql itself —
 * the same reader the app-side drift test uses, so the two gates cannot disagree
 * about what "granted" means.
 */
async function grantProblems(sql: Sql): Promise<string[]> {
  const [privilege] = (await sql`
    select has_table_privilege(${APP_ROLE}::name, 'public.design_engagements'::text, 'update')
             as "tableLevel",
           has_any_column_privilege(${APP_ROLE}::name, 'public.design_engagements'::text, 'update')
             as "columnLevel"
  `) as unknown as Array<{ tableLevel: boolean; columnLevel: boolean }>;

  // Read the columns through `has_column_privilege` over `pg_attribute` rather
  // than from `information_schema.column_privileges`. That view shows only rows
  // whose grantor or grantee is a CURRENTLY ENABLED role, so what it returns
  // depends on which role happens to be running `apply-rls` — a post-condition
  // that answers differently for two operators is not a post-condition. The
  // catalogue read is the same answer for anyone. `has_column_privilege` is true
  // for a table-level grant as well as a column-level one, which is exactly
  // right here: it reports the EFFECTIVE set, and the table-level half is
  // asserted separately above.
  const rows = (await sql`
    select a.attname as name
      from pg_attribute a
      join pg_class c     on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'design_engagements'
       and a.attnum > 0 and not a.attisdropped
       and has_column_privilege(${APP_ROLE}::name, c.oid, a.attnum, 'update')
     order by 1
  `) as unknown as Array<{ name: string }>;

  const problems: string[] = [];
  if (privilege.tableLevel) {
    problems.push(
      `  - ${APP_ROLE} has TABLE-LEVEL update on ${GRANTED_UPDATE_TABLE}, which subsumes ` +
        'every column grant — the narrowing in rls/roles.sql is cosmetic on this database',
    );
  }
  if (!privilege.columnLevel) {
    problems.push(
      `  - ${APP_ROLE} has NO update at all on ${GRANTED_UPDATE_TABLE} — every state ` +
        'transition, ROM issue, render stamp and share-token mint will fail with 42501',
    );
  }
  const granted = new Set(grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')));
  const applied = new Set(rows.map((row) => row.name));
  const missing = [...granted].filter((column) => !applied.has(column)).sort();
  const surplus = [...applied].filter((column) => !granted.has(column)).sort();
  if (missing.length > 0) {
    problems.push(
      `  - ${GRANTED_UPDATE_TABLE} column update is MISSING ${missing.join(', ')} — ` +
        'rls/roles.sql grants them and this database does not have them',
    );
  }
  if (surplus.length > 0) {
    problems.push(
      `  - ${GRANTED_UPDATE_TABLE} column update carries ${surplus.join(', ')}, which ` +
        'rls/roles.sql does not grant — a privilege nothing in the repository asked for',
    );
  }
  return problems;
}

/** One line per declared object the database does not have. Empty = applied. */
function missing(declared: Map<string, string>, applied: Set<string>, kind: string): string[] {
  return [...declared]
    .filter(([key]) => !applied.has(key))
    .map(([key, file]) => `  - ${kind} ${key} is declared in rls/${file} and is NOT in the database`);
}

/**
 * Read back everything the manifest declares. Returns one line per problem, so
 * the caller decides the exit code and the whole list is printed at once rather
 * than the first failure.
 */
export async function verifyRlsApplied(sql: Sql): Promise<string[]> {
  const problems: string[] = [];

  const flags = await rlsFlags(sql);
  for (const table of declaredTables().keys()) {
    const flag = flags.get(table);
    if (!flag) {
      problems.push(`  - table ${table} is in the drizzle schema and NOT in the database`);
    } else if (!flag.enabled || !flag.forced) {
      problems.push(
        `  - table ${table} has RLS enabled=${String(flag.enabled)} ` +
          `forced=${String(flag.forced)} — both must be true`,
      );
    }
  }

  problems.push(...missing(declaredPolicies(), await appliedPolicies(sql), 'policy'));
  problems.push(...missing(declaredTriggers(), await appliedTriggers(sql), 'trigger'));
  problems.push(...missing(declaredFunctions(), await appliedFunctions(sql), 'function'));
  problems.push(...(await appRoleProblems(sql)));
  problems.push(...(await grantProblems(sql)));

  return problems;
}

/** The counts a green run prints, so a silently-shrinking manifest is visible. */
export function declaredCounts(): string {
  return (
    `${declaredTables().size} tables, ${declaredPolicies().size} policies, ` +
    `${declaredTriggers().size} triggers, ${declaredFunctions().size} functions`
  );
}
