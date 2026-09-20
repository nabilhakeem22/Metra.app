// WHAT A FIXTURE TEARDOWN DELETES, AND IN WHAT ORDER.
//
// THIS IS THE LIST THAT LOST THE BOQ TABLES. When 0041 added boqs / boq_sections
// / boq_lines, nothing added them here, and under
// `session_replication_role = 'replica'` a missing table does not raise — it
// ORPHANS. Every interrupted run left boq rows pointing at an organization that
// had just been deleted, and every count in the run still read as success. The
// list was completed by hand afterwards; nothing stopped it happening again.
//
// So it is split out of `fixture.ts` for one reason: that file opens a postgres
// connection at module load, so nothing could ever import it to CHECK this list
// without a database. `teardown-tables.test.ts` now compares it with the drizzle
// schema's org-scoped tables on a fresh clone, in milliseconds, and reds the day
// a new org-scoped table is DECLARED rather than the next time somebody reads
// the file.
//
// THE ORDER IS NOT DERIVED and cannot be: it is foreign-key driven,
// child-before-parent, and the comments below are the reasoning for each edge.
// Only its COMPLETENESS is checked. A new table has to be placed by hand.

// Delete order is FK-safe on its own, but proposals/contracts/VOs are frozen once
// they leave draft (immutability + child-draft triggers block even a BYPASSRLS
// DELETE). We suppress those triggers SESSION-LOCALLY via
// `SET LOCAL session_replication_role = 'replica'` inside a single transaction —
// which disables user triggers for THIS session only and auto-resets on commit.
// It never touches other sessions/tenants and takes no ACCESS EXCLUSIVE lock, so
// it can't globally disable prod immutability or serialize concurrent test runs
// (the bug of the old `ALTER TABLE ... DISABLE TRIGGER`, which is global).
export const TEARDOWN_TABLES_IN_FK_ORDER = [
  // Contracts + VOs first: VOs reference contracts (restrict) and contracts
  // reference proposals (restrict), so tear these down BEFORE proposals.
  'variation_order_events',
  'variation_order_lines',
  'variation_orders',
  'contract_events',
  'contract_lines',
  'contract_sections',
  'contracts',
  // Design engagements: the milestone schedule + transition ledger cascade from
  // engagements; the engagement references clients + projects (restrict), so tear
  // the children down first, then engagements, before clients/projects.
  // client_payment_claims references payment_events (set null) + design_engagements
  // (cascade) — delete it before both so no restrict/order surprise.
  'client_payment_claims',
  // document_categories: files reference it (ON DELETE SET NULL) and its org_id FK
  // is RESTRICT, so it must go after files and before organizations.
  'document_categories',
  // engagement_document_comments cascades from BOTH design_engagements and
  // engagement_artifacts, so the deletes below would clear it either way — listed
  // explicitly so a future FK change surfaces here rather than as a restrict error.
  'engagement_document_comments',
  'payment_events',
  'engagement_events',
  'engagement_change_orders',
  'engagement_artifacts',
  'engagement_milestones',
  'engagement_transitions',
  'design_engagements',
  // BOQs reference clients AND projects with RESTRICT, so the whole BOQ tree has
  // to go before either of those. Lines and sections cascade from the BOQ, but
  // they are listed explicitly so a future FK change surfaces here as a missing
  // entry rather than as a restrict error halfway through a teardown.
  'boq_lines',
  'boq_sections',
  'boqs',
  'proposal_events',
  'proposal_lines',
  'proposal_sections',
  'proposals',
  'price_change_lines',
  'price_changes',
  'project_stages',
  // projects reference clients (restrict) -> delete projects before clients.
  'projects',
  'project_types',
  'stage_templates',
  'activities',
  'client_contacts',
  'clients',
  'cost_items',
  // sections are referenced by cost_items (restrict) -> after cost_items.
  'sections',
  'notifications',
  'automation_run_log',
  'automation_settings',
  'audit_log',
  'invitations',
  'api_keys',
  // workspace_entitlements references organizations (restrict) -> before the org.
  'workspace_entitlements',
  'memberships',
];

/**
 * `files` is polymorphic (project + client entities) and is deleted LAST, after
 * every table that points at it, which is why it sits outside the ordered list
 * above rather than in the middle of it.
 */
export const TEARDOWN_TABLES_DELETED_LAST = ['files'];

/** Every org-scoped table a teardown deletes from, in the order it deletes them. */
export const TEARDOWN_ORDER = [
  ...TEARDOWN_TABLES_IN_FK_ORDER,
  ...TEARDOWN_TABLES_DELETED_LAST,
];
