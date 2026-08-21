import { MEMBER_ROLES, type MemberRole } from './member-roles';

// Web-app source of truth (client-safe). Order mirrors the Postgres `member_role`
// enum; the match is verified by permissions.test.ts + schema.test.ts.
export { MEMBER_ROLES };
export type { MemberRole };

export type PermissionAction = 'create' | 'read' | 'update' | 'approve';

/** Capabilities from the §2.2 permission matrix. */
export type Capability =
  | 'clients'
  | 'client_activity'
  | 'projects'
  | 'project_activity'
  | 'price_book'
  | 'proposals_build'
  | 'proposals_send'
  | 'contracts_generate'
  | 'contracts_issue'
  | 'variations_draft'
  | 'variations_price'
  | 'engagements_design'
  | 'engagements_finance'
  | 'engagements_issue'
  | 'tasks_schedule'
  | 'cost_entries'
  | 'cost_entry_approval'
  | 'custody_issue'
  | 'custody_settle'
  | 'invoices_draft'
  | 'invoices_issue'
  | 'payments'
  | 'margin_pnl'
  | 'firm_dashboard'
  | 'users_settings';
