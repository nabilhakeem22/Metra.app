// WHO may see FIRM-WIDE figures. PURE and CLIENT-SAFE: the whole policy in one
// testable predicate, with no import beyond the permission matrix it consults.
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';

/**
 * The roles the firm-level dashboard narrows to when the org restricts it. The
 * studio was promised exactly this, in both catalogues: "Limit firm-wide figures
 * to owners and admins" / "قصر أرقام الشركة كلها على الملاك والمسؤولين بس".
 */
const UNRESTRICTED_FIRM_ROLES: ReadonlySet<MemberRole> = new Set([
  'owner',
  'admin',
]);

/**
 * May this role see FIRM-WIDE figures (the headline counts and the charts)?
 *
 * TWO GATES, ANSWERING DIFFERENT QUESTIONS.
 *
 * The §2.2 grant answers "is this role EVER entitled to firm-level numbers".
 * `project_manager` and `site_engineer` hold the empty cell for
 * `firm_dashboard` and are not — and nothing enforced that until now: the page
 * never called `can()` at all, so every role saw every firm-wide count and both
 * charts. Enforcing the grant is therefore a live behaviour change even with the
 * org setting OFF, which is the finding rather than a side effect of it.
 *
 * The org setting answers "has this firm chosen to narrow it further", and it
 * narrows to owner + admin, which SUBTRACTS accountant and viewer. It is not
 * what fences a PM; the base grant is.
 *
 * `client` never reaches this question — wave 3's `require-org.ts` fence
 * `notFound()`s the whole `(app)` group for a client membership — but it answers
 * `false` here too, because a predicate that depends on a fence somewhere else
 * being intact is not a predicate.
 */
export function canSeeFirmFigures(
  role: MemberRole,
  org: { restrictFirmDashboard: boolean },
): boolean {
  if (!can(role, 'firm_dashboard', 'read')) return false;
  return org.restrictFirmDashboard ? UNRESTRICTED_FIRM_ROLES.has(role) : true;
}
