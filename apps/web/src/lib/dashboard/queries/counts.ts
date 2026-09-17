import 'server-only';
// The dashboard's HEADLINE COUNTS. One round trip per figure, all of them
// aggregated in Postgres rather than by pulling rows into the Worker.
//
// Split out of a 210-line `dashboard/queries.ts` that did three unrelated jobs
// (counts, monthly trends, the deliveries triage list) — see ./index.ts.
import {
  clients,
  designEngagements,
  memberships,
  projects,
  type MetraDb,
} from '@metra/db';
import { count, notInArray, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { TERMINAL_STATES } from '@/lib/engagements/states';

/** The three off-ramps, as the array drizzle's `notInArray` wants. */
const TERMINAL = [...TERMINAL_STATES];

export interface DashboardCounts {
  clientsTotal: number;
  clientsActive: number;
  projectsTotal: number;
  projectsActive: number;
  /** null when the caller may not read team settings — then it is never counted. */
  teamMembers: number | null;
  deliveriesTotal: number;
  /** Non-terminal — the work actually in flight. */
  deliveriesActive: number;
}

/** A total/active pair, as every count below answers it. */
interface TotalAndActive {
  total: number;
  active: number;
}

/** Clients: `active` is the boolean flag on the row. */
async function countClients(tx: MetraDb): Promise<TotalAndActive> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${clients.active})::int`,
    })
    .from(clients);
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

/** Projects: `active` is the project STATUS a firm means by "live work", not
 *  the soft-delete flag — projects use a status enum, clients use a boolean. */
async function countProjects(tx: MetraDb): Promise<TotalAndActive> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
    })
    .from(projects);
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

/** Deliveries, counted rather than pulled: a firm with 300 of them should cost
 *  one grouped query, same as the other three figures. The `(org_id, state)`
 *  index covers the filter. `active` is non-terminal — the work in flight. */
async function countDeliveries(tx: MetraDb): Promise<TotalAndActive> {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${notInArray(designEngagements.state, TERMINAL)})::int`,
    })
    .from(designEngagements);
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

/**
 * The headline cards. One round trip. The team headcount is only counted when
 * the caller asks for it — the card that shows it is gated on `users_settings`,
 * so a role that cannot open /team does not get the firm's headcount either.
 */
export function getDashboardCounts(
  ctx: OrgContext,
  options: { includeTeamMembers: boolean },
): Promise<DashboardCounts> {
  return withOrgContext(ctx, async (tx) => {
    const clientCounts = await countClients(tx);
    const projectCounts = await countProjects(tx);
    const teamMembers = options.includeTeamMembers
      ? ((await tx.select({ n: count() }).from(memberships))[0]?.n ?? 0)
      : null;
    const deliveryCounts = await countDeliveries(tx);
    return {
      clientsTotal: clientCounts.total,
      clientsActive: clientCounts.active,
      projectsTotal: projectCounts.total,
      projectsActive: projectCounts.active,
      teamMembers,
      deliveriesTotal: deliveryCounts.total,
      deliveriesActive: deliveryCounts.active,
    };
  });
}
