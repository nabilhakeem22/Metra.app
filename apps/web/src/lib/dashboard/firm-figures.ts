import 'server-only';
// The FIRM-WIDE block of the dashboard, loaded only for a role entitled to it.
//
// The gate decides BEFORE any query is issued, so a fenced role costs zero round
// trips — the same shape the deliveries panel already uses. That is not only an
// optimisation: a count that is never computed cannot leak through a log line,
// a cache or a serialisation slip.
import type { OrgContext } from '@/lib/db/context';
import { canSeeFirmFigures } from './firm-visibility';
import type { RangeMonths } from './range';
import {
  getClientsByMonth,
  getDashboardCounts,
  getProjectsByMonth,
  type ClientsMonth,
  type DashboardCounts,
  type ProjectsMonth,
} from './queries';

/** The four headline counts and the two monthly series behind the charts. */
export interface FirmFigures {
  counts: DashboardCounts;
  projectMonths: ProjectsMonth[];
  clientMonths: ClientsMonth[];
}

/**
 * The firm-wide block, or NULL when this role may not see it.
 *
 * NULL IS THE REFUSAL, and the page renders nothing in its place (A5) — no
 * locked card, no "ask your owner" notice. A placeholder advertises the
 * existence and the shape of the figures the studio chose to withhold, which is
 * the opposite of what the setting is for.
 */
export async function loadFirmFigures(
  ctx: OrgContext,
  options: {
    org: { restrictFirmDashboard: boolean };
    range: RangeMonths;
    includeTeamMembers: boolean;
  },
): Promise<FirmFigures | null> {
  if (!canSeeFirmFigures(ctx.role, options.org)) return null;
  const [counts, projectMonths, clientMonths] = await Promise.all([
    getDashboardCounts(ctx, { includeTeamMembers: options.includeTeamMembers }),
    getProjectsByMonth(ctx, options.range),
    getClientsByMonth(ctx, options.range),
  ]);
  return { counts, projectMonths, clientMonths };
}
