// WHO may see the rescue ledger (owner decision D1). PURE and CLIENT-SAFE: the
// whole policy in one predicate, consulted by the dashboard page (to render the
// island at all) and by the core (to refuse before any query).
import { canSeeFirmFigures } from '@/lib/dashboard/firm-visibility';
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';

/**
 * The studio's finance roles (owner, admin, accountant), and only while the org
 * lets that role see firm-wide figures: "limit firm figures to owners and
 * admins" narrows the ledger to owner and admin.
 *
 * The finance roles are the ones that WORK the engagement finances
 * (`engagements_finance` update). Read alone is not the test: `viewer` holds a
 * read-only cell there and D1 leaves the viewer out.
 */
export function canSeeRescueLedger(
  role: MemberRole,
  org: { restrictFirmDashboard: boolean },
): boolean {
  return can(role, 'engagements_finance', 'update') && canSeeFirmFigures(role, org);
}
