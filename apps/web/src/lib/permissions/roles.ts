import { MEMBER_ROLES, type MemberRole } from '@merta/db';

// Single source of truth is the DB enum (@merta/db). Re-exported so the web app
// imports roles from one place. Order matches the Postgres `member_role` enum.
export { MEMBER_ROLES };
export type { MemberRole };

export type PermissionAction = 'create' | 'read' | 'update' | 'approve';

/** Capabilities from the §2.2 permission matrix. */
export type Capability =
  | 'clients'
  | 'projects'
  | 'price_book'
  | 'proposals_build'
  | 'proposals_send'
  | 'contracts_generate'
  | 'contracts_issue'
  | 'variations_draft'
  | 'variations_price'
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

export const LETTER_TO_ACTION: Record<string, PermissionAction> = {
  C: 'create',
  R: 'read',
  U: 'update',
  A: 'approve',
};
