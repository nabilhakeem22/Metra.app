// Who may do what with a contract's cost entries (lead ruling on PR B3, F1 and
// S1). PURE and CLIENT-SAFE: the cores, the reads and both pages that show
// costs read the same rule.
//
// - Reading and recording are the `cost_entries` row of the matrix alone,
//   never `contracts_generate`: the people on site record costs without
//   opening the contract page and its money.
// - Editing and voiding are scoped by row: owner and admin keep every entry;
//   any other role that may update keeps only what it recorded itself.
import type { MemberRole } from '@/lib/permissions/roles';
import { can } from '@/lib/permissions/can';

/** The roles that may edit or void ANY live entry, whoever recorded it. */
export const COST_ENTRY_KEEPERS: readonly MemberRole[] = ['owner', 'admin'];

/** Lists a contract's costs (with their amounts and totals). */
export function mayReadCostEntries(role: MemberRole): boolean {
  return can(role, 'cost_entries', 'read');
}

/** Records a new cost. */
export function mayRecordCostEntries(role: MemberRole): boolean {
  return can(role, 'cost_entries', 'create');
}

/** Finds a contract line to book a cost to: whoever may record or edit one. */
export function maySearchCostEntryLines(role: MemberRole): boolean {
  return can(role, 'cost_entries', 'create') || can(role, 'cost_entries', 'update');
}

/** Edits or voids an entry: any of them for a keeper, only its own for another role that may update. */
export function mayChangeCostEntry(role: MemberRole, entry: { recordedBy: string }, userId: string): boolean {
  if (!can(role, 'cost_entries', 'update')) return false;
  return COST_ENTRY_KEEPERS.includes(role) || entry.recordedBy === userId;
}
