// The delete order for a fixture-org purge, and the catalog check that keeps it
// honest. Split out of purge-fixture-orgs.ts so the script itself stays about
// the decision (what is doomed) rather than the mechanics (what to delete).
import type { PostgresJs } from '../client';
import {
  ORGANIZATIONS_VISIBLE_QUERY,
  orphanOrgRowsQuery,
  orphanReportLines,
  type OrphanOrgRows,
} from './org-orphan-rows';
import { orgScopedTableNames } from './schema-catalogue';

/**
 * Guarded by the immutability / parent-draft triggers: these rows are frozen
 * once they leave 'draft', so DELETE raises MT100. Suppressed with
 * `session_replication_role = 'replica'`, which ALSO suspends FK enforcement,
 * which is exactly why the window is this narrow and no wider. Nothing outside
 * this block references proposals/contracts/variation_orders.
 */
export const TRIGGER_GUARDED_TABLES = [
  'variation_order_events', 'variation_order_lines', 'variation_orders',
  'contract_events', 'contract_lines', 'contract_sections', 'contracts',
  'proposal_events', 'proposal_lines', 'proposal_sections', 'proposals',
];

/** Deleted with referential integrity ON, so a missing table fails loudly. */
export const REMAINING_TABLES = [
  'boq_lines', 'boq_sections', 'boqs',
  'client_payment_claims', 'engagement_document_comments',
  // Change orders BEFORE payment_events: 0046 gave them a SET NULL FK edge to
  // it, so deleting the payments first fires a pointless UPDATE over rows this
  // very statement list is about to delete.
  'engagement_change_orders', 'payment_events',
  'engagement_events', 'engagement_artifacts',
  'engagement_milestones', 'engagement_transitions', 'design_engagements',
  'price_change_lines', 'price_changes', 'project_stages', 'projects',
  'project_types', 'stage_templates', 'activities', 'client_contacts',
  'clients', 'cost_items', 'sections', 'files', 'document_categories',
  'notifications', 'automation_run_log', 'automation_settings', 'audit_log',
  'invitations', 'api_keys', 'workspace_entitlements', 'memberships',
];

export const DELETE_ORDER = [...TRIGGER_GUARDED_TABLES, ...REMAINING_TABLES];

/**
 * The fixture's own teardown list silently lost the BOQ tables when 0041 landed.
 * Under replica mode a missing table orphans rows instead of erroring, so
 * completeness is never taken from this file's own word.
 *
 * TWO SOURCES, BOTH CHECKED, because they fail differently. The DRIZZLE SCHEMA
 * (`orgScopedTableNames()`) is checkable with no database at all, which is what
 * `purge-fixture-orgs-tables.test.ts` uses to red on a new org-scoped table the
 * moment it is declared — before anyone runs a purge. The live CATALOG is what
 * catches the other direction: a table this database has and the schema does not
 * declare, which no unit test can see.
 *
 * COMPLETENESS ONLY — this asserts that every org-scoped table is IN the list,
 * never that the list is in a workable ORDER. Order is FK-driven and is proven
 * by running the purge (a wrong one raises a foreign-key violation outside the
 * replica-mode window), so a new table must be placed by hand, child first. That
 * is the one thing here that cannot be derived, and the reason DELETE_ORDER is
 * still written out above rather than generated.
 */
export async function assertDeleteOrderCoversEveryOrgScopedTable(
  sql: PostgresJs,
): Promise<void> {
  const rows = await sql<{ t: string }[]>`
    select table_name as t from information_schema.columns
    where table_schema = 'public' and column_name = 'org_id'`;
  const covered = new Set(DELETE_ORDER);
  const missing = [...new Set([...rows.map((r) => r.t), ...orgScopedTableNames()])]
    .filter((t) => !covered.has(t))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `DELETE_ORDER is missing org-scoped table(s): ${missing.join(', ')}. ` +
        'Add each one to TRIGGER_GUARDED_TABLES or REMAINING_TABLES BY HAND, child ' +
        'before parent — the list is ordered by foreign keys and cannot be derived.',
    );
  }
}

/**
 * The purge's POST-CONDITION: not one row anywhere whose `org_id` names no
 * organization.
 *
 * This is the only thing that can see into the `session_replication_role =
 * 'replica'` window. Inside it foreign keys are not enforced, so a table missing
 * from DELETE_ORDER does not raise — it leaves rows pointing at an organization
 * that has just been deleted, and every count in the run still reads as success.
 * The completeness check above is the prevention; this is the proof, and it is
 * the one that would survive a table being present in the list but deleted in the
 * wrong order.
 *
 * THROWS, and deliberately after the work: there is nothing to roll back by then
 * — each chunk committed on its own — so the value of failing here is that the
 * operator is told before `db:reindex-after-purge` and before anyone calls the
 * purge done.
 */
async function assertOrganizationsVisible(sql: PostgresJs): Promise<void> {
  const [visible] = await sql.unsafe<Array<{ rows: unknown }>>(ORGANIZATIONS_VISIBLE_QUERY);
  if (!visible || Number(visible.rows) === 0) {
    throw new Error(
      'the orphan check cannot see public.organizations (0 rows, or no row at all). ' +
        'Every table would report fully orphaned, so the check is refusing to report at ' +
        'all — a privilege or RLS problem on this connection, not a purge failure.',
    );
  }
}

export async function assertNoOrphanOrgRows(
  sql: PostgresJs,
  orgIds: readonly string[],
): Promise<void> {
  if (orgIds.length === 0) {
    console.log('orphan check: this run deleted no organization, so there is nothing to check.');
    return;
  }
  await assertOrganizationsVisible(sql);
  const counts = await sql.unsafe<OrphanOrgRows[]>(
    orphanOrgRowsQuery(DELETE_ORDER, 'these-orgs'),
    [orgIds as string[]],
  );
  const lines = orphanReportLines(counts);
  if (lines.length > 0) {
    throw new Error(
      `the purge left ORPHANED rows — org_id naming one of the ${String(orgIds.length)} ` +
        `organization(s) IT deleted:\n${lines.join('\n')}\n\n` +
        'That means a table was deleted in the wrong order, or was deleted inside the ' +
        'replica-mode window where foreign keys are not enforced. The rows are still ' +
        'there; delete them by org_id before anything else touches this database.',
    );
  }
  console.log(
    `orphan check: ${String(counts.length)} org-scoped table(s) answered, 0 rows left ` +
      `behind by the ${String(orgIds.length)} organization(s) this run deleted.`,
  );
}

/**
 * Orphans this run did NOT create — every org_id in the database naming no
 * organization, whoever left it. REPORT ONLY, and printed in the DRY RUN, which
 * is the one moment the operator can still act on it.
 *
 * Separate from the post-condition above, and separate on purpose (wave 8 F3).
 * The first version asked the GLOBAL question and THREW on it, after the purge
 * had already committed its chunks: one pre-existing orphan anywhere made every
 * later `--execute` fail over something the operator could neither cause nor
 * undo, and which said nothing at all about the purge.
 */
export async function reportPreExistingOrphans(sql: PostgresJs): Promise<void> {
  let counts: OrphanOrgRows[];
  try {
    await assertOrganizationsVisible(sql);
    counts = await sql.unsafe<OrphanOrgRows[]>(orphanOrgRowsQuery(DELETE_ORDER, 'every-org'));
  } catch (error) {
    console.log(`pre-existing orphans: could not be read: ${(error as Error).message}`);
    return;
  }
  const lines = orphanReportLines(counts);
  if (lines.length === 0) {
    console.log(
      `pre-existing orphans: ${String(counts.length)} org-scoped table(s) answered, none ` +
        'holds a row whose org_id names no organization.',
    );
    return;
  }
  console.log(
    `pre-existing orphans: ${String(lines.length)} table(s) ALREADY hold rows whose org_id ` +
      'names no organization. This purge did not cause them and will not fail on ' +
      `them:\n${lines.join('\n')}`,
  );
}
