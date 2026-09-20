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
//   * five NARROWED tables — boqs, document_categories,
//     engagement_document_comments, engagement_milestones,
//     workspace_entitlements — hold exactly the table-level privileges roles.sql
//     leaves them with after its revokes, AND do not hold the one privilege each
//     narrowing exists to remove (no DELETE on boqs, no UPDATE/DELETE on the
//     append-only three, no DELETE on the filing vocabulary). Until wave 8 item 6
//     NOTHING checked these: a `revoke` converges only if it RAN, and four of the
//     five exist purely for databases provisioned before the narrowing was
//     written — the exact databases where reading roles.sql tells you nothing;
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
// EVERY PRIVILEGE READ RESOLVES ITS TABLE THROUGH `pg_class` rather than through
// a `'public.<name>'::text` argument. The text form raises 42P01 on a table the
// database does not have, and that exception does not become a problem LINE — it
// escapes this function and discards every problem already collected, so the one
// run that most needs a list (a database behind its migrations) prints none.
// A LEFT JOIN answers a null oid, the strict privilege functions answer null on
// it, and the missing table is reported like anything else (wave 8 F9).
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
import {
  APP_ROLE,
  TABLE_PRIVILEGES,
  describePrivileges,
  tablePrivilegesFor,
  type TablePrivilege,
} from './roles-grants';
import { declaredTables } from './schema-catalogue';

type Sql = ReturnType<typeof createSql>;

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
  // GUARDED ON THE TABLE EXISTING (wave 8 F9). `has_table_privilege(…, text, …)`
  // raises 42P01 on a name the database does not have, and that exception is not
  // a problem LINE — it escapes `verifyRlsApplied` and throws away every problem
  // already collected, so a database missing this table reports nothing about
  // the forty-six it has. Resolved through `pg_class` instead: a LEFT JOIN
  // yields a null oid, the privilege functions are strict and answer null on it,
  // and "the table is not there" becomes a line like any other.
  const [privilege] = (await sql`
    select c.oid is not null as "tableExists",
           coalesce(has_table_privilege(${APP_ROLE}::name, c.oid, 'update'), false)
             as "tableLevel",
           coalesce(has_any_column_privilege(${APP_ROLE}::name, c.oid, 'update'), false)
             as "columnLevel"
      from (select 1) as present
      left join pg_class c
        on c.relname = 'design_engagements'
       and c.relnamespace = 'public'::regnamespace
  `) as unknown as Array<{ tableExists: boolean; tableLevel: boolean; columnLevel: boolean }>;

  if (!privilege || !privilege.tableExists) {
    return [
      `  - ${GRANTED_UPDATE_TABLE} is not in this database at all, so nothing here ` +
        'says anything about its UPDATE authority. Run the migrations first.',
    ];
  }

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

/**
 * The tables whose TABLE-LEVEL grants are read back, and why these.
 *
 * Every one of them is a NARROWING that `rls/roles.sql` performs with a `revoke`,
 * and a revoke only converges if it RAN. Four of the five lines exist purely to
 * remove a privilege from databases provisioned before the narrowing was written
 * — which means the databases where they matter are exactly the ones where
 * reading the file tells you nothing.
 *
 *   boqs                          no DELETE — an issued BOQ is the priced record
 *                                 a contract is generated from; deleting one
 *                                 deletes the evidence.
 *   engagement_milestones         INSERT-only — under the "absent milestone =
 *                                 free gate" rule, an UPDATE or DELETE here
 *                                 waives a PAYING gate.
 *   document_categories           no DELETE — files point at a category, and
 *                                 retiring one must not pull it out from under
 *                                 them.
 *   engagement_document_comments  append-only — neither side may edit or retract
 *                                 a message once sent, which is what makes the
 *                                 thread the record of what the client asked for.
 *   workspace_entitlements        INSERT-only — an UPDATE here is a member
 *                                 granting themselves a flow or raising a limit.
 *
 * `design_engagements` is NOT in this list: its authority is column-level and is
 * read back separately by `grantProblems`, which is a different question.
 *
 * Extending this to every table in roles.sql is one line and is deliberately not
 * done here: each addition is a new way for `apply-rls` to fail on a database
 * nobody can test against first, and these five are the narrowings the wave asked
 * for.
 *
 * THE VALUE IS THE PRIVILEGE THAT MUST NOT BE THERE, and it is written down
 * rather than derived. The comparison below is against roles.sql, which follows
 * whatever roles.sql says — so an edit that re-granted `delete on boqs` would
 * move BOTH sides and stay green. This list does not move. It is the invariant;
 * roles.sql is the implementation of it.
 */
const NARROWED_TABLES: Record<string, readonly TablePrivilege[]> = {
  boqs: ['delete'],
  document_categories: ['delete'],
  engagement_document_comments: ['update', 'delete'],
  engagement_milestones: ['update', 'delete'],
  workspace_entitlements: ['update', 'delete'],
};

/** One cell of the table-privilege read-back. */
interface AppliedPrivilege {
  table_name: string;
  privilege: string;
  /** False when this database has no such table — see the read below. */
  table_exists: boolean;
  granted: boolean;
}

/**
 * Do the TABLE-LEVEL grants on the narrowed tables match what roles.sql declares?
 *
 * Read with `has_table_privilege`, one call per (table, privilege), because that
 * function reports the EFFECTIVE answer for any operator — unlike
 * `information_schema.table_privileges`, which shows only rows whose grantor or
 * grantee is a currently enabled role and therefore answers differently depending
 * on who is running `apply-rls`. A post-condition that answers differently for
 * two operators is not a post-condition (wave 7 D7 learned this on the column
 * half).
 *
 * BOTH DIRECTIONS ARE REPORTED. A missing privilege is an outage — the studio
 * cockpit 42501s. A SURPLUS one is the failure this exists for: the narrowing
 * silently absent on a database provisioned before it was written.
 */
async function narrowedTableGrantProblems(sql: Sql): Promise<string[]> {
  const rolesSql = readFileSync(ROLES_SQL, 'utf8');
  const tables = Object.keys(NARROWED_TABLES).sort();
  const privileges = [...TABLE_PRIVILEGES];
  // Resolved through `pg_class`, not through `('public.' || name)::text`: that
  // form raises 42P01 on a table the database does not have, and the exception
  // would escape `verifyRlsApplied` and discard every problem already collected
  // (wave 8 F9). A LEFT JOIN gives a null oid, the strict privilege function
  // answers null on it, and the missing table is reported as its own line.
  const rows = (await sql`
    select t.name as table_name, p.name as privilege,
           c.oid is not null as table_exists,
           coalesce(has_table_privilege(${APP_ROLE}::name, c.oid, p.name), false) as granted
      from unnest(${tables}::text[]) as t(name)
      cross join unnest(${privileges}::text[]) as p(name)
      left join pg_class c on c.relname = t.name and c.relnamespace = 'public'::regnamespace
     order by 1, 2
  `) as unknown as AppliedPrivilege[];

  const problems: string[] = [];
  for (const table of tables) {
    const declared = tablePrivilegesFor(rolesSql, table);
    const applied = new Set(
      rows
        .filter((row) => row.table_name === table && row.granted)
        .map((row) => row.privilege as TablePrivilege),
    );
    const answered = rows.filter((row) => row.table_name === table);
    if (answered.length === 0) {
      problems.push(
        `  - ${table} was not read back at all — the privilege matrix returned no row ` +
          'for it, so nothing here says anything about its grants',
      );
      continue;
    }
    if (!answered[0].table_exists) {
      problems.push(
        `  - ${table} is not in this database at all, so its grants cannot be checked. ` +
          'Run the migrations first.',
      );
      continue;
    }
    const missing = TABLE_PRIVILEGES.filter(
      (privilege) => declared.has(privilege) && !applied.has(privilege),
    );
    const surplus = TABLE_PRIVILEGES.filter(
      (privilege) => applied.has(privilege) && !declared.has(privilege),
    );
    if (missing.length > 0) {
      problems.push(
        `  - ${APP_ROLE} is MISSING ${missing.join(', ')} on ${table} — rls/roles.sql ` +
          `grants ${describePrivileges(declared)} and this database has ` +
          `${describePrivileges(applied)}`,
      );
    }
    if (surplus.length > 0) {
      problems.push(
        `  - ${APP_ROLE} still has ${surplus.join(', ')} on ${table}, which rls/roles.sql ` +
          `REVOKES — it grants ${describePrivileges(declared)} and this database has ` +
          `${describePrivileges(applied)}. A revoke converges only if it RAN, and that ` +
          'line exists for databases provisioned before the narrowing was written',
      );
    }
    // The invariant, asked of BOTH sides. The comparison above follows roles.sql
    // wherever it goes; this does not move, so an edit that re-granted the
    // privilege is reported from the file AND from the database.
    for (const forbidden of NARROWED_TABLES[table]) {
      if (declared.has(forbidden)) {
        problems.push(
          `  - rls/roles.sql GRANTS ${forbidden} on ${table} to ${APP_ROLE}, and it must ` +
            'not. This is a deliberate narrowing, not an oversight — re-granting it ' +
            'needs the commit that builds the path that needs it, and an update to this ' +
            'list in verify-rls-applied.ts',
        );
      }
      if (applied.has(forbidden)) {
        problems.push(
          `  - ${APP_ROLE} has ${forbidden} on ${table} in THIS DATABASE, and it must ` +
            'not. Re-run apply-rls; if it survives that, someone granted it by hand',
        );
      }
    }
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
  problems.push(...(await narrowedTableGrantProblems(sql)));

  return problems;
}

/**
 * What the GRANT half of a green run checked, so a read-back that quietly stopped
 * asking is visible in the output rather than only in this file.
 */
export function verifiedGrantsSummary(): string {
  const narrowed = Object.keys(NARROWED_TABLES).sort();
  return (
    `grants verified — ${GRANTED_UPDATE_TABLE} update narrowed to ` +
    `${String(grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')).length)} columns with no ` +
    `table-level update, and ${String(narrowed.length)} narrowed table(s) ` +
    `(${narrowed.join(', ')}) holding exactly what rls/roles.sql leaves them.`
  );
}

/** The counts a green run prints, so a silently-shrinking manifest is visible. */
export function declaredCounts(): string {
  return (
    `${declaredTables().size} tables, ${declaredPolicies().size} policies, ` +
    `${declaredTriggers().size} triggers, ${declaredFunctions().size} functions`
  );
}
