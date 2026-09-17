import 'server-only';
// WHAT THE DASHBOARD READS, and what it deliberately does not.
//
// The page used to hold this: three capability decisions, a three-way fan-out and
// thirty lines explaining why each one is shaped the way it is. That is business
// logic about entitlement, not a page, and it had no home where it could be read
// without scrolling past JSX.
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { loadFirmFigures, type FirmFigures } from './firm-figures';
import { canSeeFirmFigures } from './firm-visibility';
import type { RangeMonths } from './range';
import {
  countActiveDeliveries,
  listDashboardDeliveries,
  type DashboardDelivery,
} from './queries';

/** How many in-flight deliveries the panel shows before deferring to the list. */
export const DELIVERY_ROWS = 6;

export interface DashboardFigures {
  /** NULL when this role may not see firm-wide figures (wave-4 A5). */
  firm: FirmFigures | null;
  /** NULL when this role cannot read engagements at all. */
  deliveries: { rows: DashboardDelivery[]; totalActive: number } | null;
  canSeeDeliveries: boolean;
  canSeeTeam: boolean;
}

/**
 * Everything the dashboard shows, in ONE fan-out.
 *
 * The deliveries panel is hidden entirely from roles that cannot read
 * engagements, so the query is not even issued for them; the team headcount is
 * gated the same way, on the capability that guards /team itself.
 *
 * THE FIRM-WIDE BLOCK IS NULL FOR A ROLE THAT MAY NOT SEE IT — the four stat
 * cards, both charts and the range filter — and `loadFirmFigures` decides that
 * BEFORE issuing a query, so a fenced role costs zero round trips and the
 * figures it may not see are never computed at all. See `./firm-visibility` for
 * the two gates (the §2.2 grant, then the org's own narrowing) and why a refusal
 * renders NOTHING rather than a locked placeholder.
 */
export async function loadDashboardFigures(
  ctx: OrgContext,
  options: { org: { restrictFirmDashboard: boolean }; range: RangeMonths },
): Promise<DashboardFigures> {
  const canSeeDeliveries = can(ctx.role, 'engagements_design', 'read');
  const canSeeTeam = can(ctx.role, 'users_settings', 'read');
  // The panel's badge counts the SAME rows the panel lists, so a role entitled
  // to the work list but not to firm figures still gets a TRUE number rather
  // than the capped `rows.length`. One extra indexed count, and only on the
  // fenced path — a caller that already has the firm block reads it from there.
  //
  // It joins the FAN-OUT rather than following it. `canSeeFirmFigures` is pure
  // and is the same predicate `loadFirmFigures` applies to decide whether to
  // issue anything, so whether this count is needed is knowable here, before any
  // query runs. Awaiting it after the Promise.all added a whole serial
  // `withOrgContext` — BEGIN, the GUC preamble, the count, COMMIT — to the
  // critical path of precisely the roles this page was made cheaper for.
  const entitledToFirmFigures = canSeeFirmFigures(ctx.role, options.org);
  const [firm, rows, fencedActiveCount] = await Promise.all([
    loadFirmFigures(ctx, { ...options, includeTeamMembers: canSeeTeam }),
    canSeeDeliveries
      ? listDashboardDeliveries(ctx, DELIVERY_ROWS)
      : Promise.resolve([]),
    !entitledToFirmFigures && canSeeDeliveries
      ? countActiveDeliveries(ctx)
      : Promise.resolve(null),
  ]);

  return {
    firm,
    deliveries: canSeeDeliveries
      ? {
          rows,
          totalActive: firm?.counts.deliveriesActive ?? fencedActiveCount ?? 0,
        }
      : null,
    canSeeDeliveries,
    canSeeTeam,
  };
}
