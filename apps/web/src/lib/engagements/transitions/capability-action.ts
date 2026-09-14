/**
 * Which §2.2 permission ACTION each engagement capability family gates on.
 *
 * PURE and CLIENT-SAFE — type-only imports, no value import, no `server-only`.
 * That is the whole reason this file exists. The map had to be declared twice:
 * once in the server-only executor, which enforces it, and once in the
 * client-safe UI module, which decides whether to offer the button at all. The
 * UI copy even carried a comment saying it was a mirror, which is an admission
 * that nothing kept the two in step.
 *
 * A drift between them is not symmetrical. If the UI copy loosened, the studio
 * would be shown a button that always fails. If it tightened, a permitted user
 * would simply lose an action with no explanation. Neither is visible to a type
 * check, because both copies type-check perfectly on their own.
 */
import type { PermissionAction } from '@/lib/permissions/roles';
import type { CapabilityKey } from './types';

/**
 * Design and finance triggers are `update` moves — owner/admin/PM progress the
 * work, or the accountant does. The issue family MINTS A CLIENT-FACING ARTEFACT
 * and is `approve`-only (owner/admin), the same posture as issuing a contract;
 * `update` is not granted for `engagements_issue` at all, so gating it on
 * `update` would deny everyone.
 */
export const CAPABILITY_ACTION: Record<CapabilityKey, PermissionAction> = {
  engagements_design: 'update',
  engagements_finance: 'update',
  engagements_issue: 'approve',
};
