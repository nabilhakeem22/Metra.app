// The delete order for a fixture-org purge, and the catalog check that keeps it
// honest. Split out of purge-fixture-orgs.ts so the script itself stays about
// the decision (what is doomed) rather than the mechanics (what to delete).
import type { PostgresJs } from '../client';

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
 * Under replica mode a missing table orphans rows instead of erroring, so the
 * CATALOG, not this file, is the source of truth for completeness.
 *
 * COMPLETENESS ONLY — this asserts that every org-scoped table is IN the list,
 * never that the list is in a workable ORDER. Order is FK-driven and is proven
 * by running the purge (a wrong one raises a foreign-key violation outside the
 * replica-mode window), so a new table must be placed by hand, child first.
 */
export async function assertDeleteOrderCoversEveryOrgScopedTable(
  sql: PostgresJs,
): Promise<void> {
  const rows = await sql<{ t: string }[]>`
    select table_name as t from information_schema.columns
    where table_schema = 'public' and column_name = 'org_id'`;
  const missing = rows.map((r) => r.t).filter((t) => !DELETE_ORDER.includes(t));
  if (missing.length > 0) {
    throw new Error(
      `DELETE_ORDER is missing org-scoped table(s): ${missing.join(', ')}`,
    );
  }
}
