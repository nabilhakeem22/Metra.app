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
//   * twenty-three NARROWED tables — boqs, document_categories,
//     engagement_document_comments, engagement_milestones,
//     workspace_entitlements, the six SELECT-only market tables, the five
//     Stage 2 execution tables that may not be deleted from (0063) and the
//     seven Stage 3 site tables (0064) — hold exactly the table-level privileges roles.sql
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
// ONE-DIRECTIONAL, like `schema-catalogue.ts`: an EXTRA trigger or function in
// the database is never reported. Only "the code declares it and the database
// does not have it". POLICIES ARE THE EXCEPTION (Stage 2, security review S4):
// they are permissive and OR together, so an extra one widens access, and it
// is reported. So are TRUNCATE, REFERENCES and TRIGGER for metra_app on any
// table (roles.sql grants none), and the three column-level grants
// (./column-grants.ts): INSERT on contract_line_measurements, UPDATE on
// contract_cost_entries and on contract_payment_claims.
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
import { columnGrantProblems, columnGrantsSummary } from './column-grants';
import { GRANTED_UPDATE_TABLE, grantedUpdateColumns } from './design-engagement-grant';
import { declaredFunctions, declaredPolicies, declaredTriggers } from './rls-catalogue';
import { APP_ROLE } from './roles-grants';
import { declaredTables } from './schema-catalogue';
import {
  appRoleProblems,
  appliedFunctions,
  appliedPolicies,
  appliedTriggers,
  rlsFlags,
} from './verify-rls-catalogue-reads';
import { designEngagementUpdateProblems } from './verify-rls-design-engagement-update';
import { narrowedTableGrantProblems } from './verify-rls-narrowed-grants';
import { NARROWED_TABLES } from './verify-rls-narrowed-tables';
import { ROLES_SQL, type Sql } from './verify-rls-shared';
import {
  NEVER_GRANTED_PRIVILEGES,
  neverGrantedPrivilegeProblems,
  surplusPolicies,
} from './verify-rls-surplus';

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

  const policies = await appliedPolicies(sql);
  problems.push(...missing(declaredPolicies(), policies, 'policy'));
  problems.push(...surplusPolicies(declaredPolicies(), policies));
  problems.push(...missing(declaredTriggers(), await appliedTriggers(sql), 'trigger'));
  problems.push(...missing(declaredFunctions(), await appliedFunctions(sql), 'function'));
  problems.push(...(await appRoleProblems(sql)));
  problems.push(...(await designEngagementUpdateProblems(sql)));
  problems.push(...(await narrowedTableGrantProblems(sql)));
  problems.push(...(await neverGrantedPrivilegeProblems(sql)));
  problems.push(...(await columnGrantProblems(sql)));

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
    `(${narrowed.join(', ')}) holding exactly what rls/roles.sql leaves them; ` +
    `${columnGrantsSummary()}; no ` +
    `${NEVER_GRANTED_PRIVILEGES.join(', ')} for ${APP_ROLE} on any table; no policy outside the manifest.`
  );
}

/** The counts a green run prints, so a silently-shrinking manifest is visible. */
export function declaredCounts(): string {
  return (
    `${declaredTables().size} tables, ${declaredPolicies().size} policies, ` +
    `${declaredTriggers().size} triggers, ${declaredFunctions().size} functions`
  );
}
