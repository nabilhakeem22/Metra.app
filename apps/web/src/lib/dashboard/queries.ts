import 'server-only';
// The dashboard's real numbers.
//
// What was here before was a hardcoded placeholder — `activeProjects: '0'` and five
// em-dashes — so nothing on the old dashboard was ever read from the database. These
// are the first genuine figures on it.
//
// Every read is RLS-scoped through withOrgContext, so a workspace only ever sees its
// own counts, and the aggregates are done in Postgres rather than by pulling rows
// into the Worker: a firm with 300 projects should cost one grouped query, not 300
// rows over the wire.
import { clients, designEngagements, memberships, projects } from '@metra/db';
import { asc, count, eq, gte, notInArray, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { DesignState } from '@/lib/engagements/states';
import { TERMINAL_STATES } from '@/lib/engagements/states';
import type { MonthlyBucket, RangeMonths } from './range';

/** The three off-ramps, as an array the query builder can use. */
const TERMINAL = [...TERMINAL_STATES];

export interface DashboardCounts {
  clientsTotal: number;
  clientsActive: number;
  projectsTotal: number;
  projectsActive: number;
  teamMembers: number;
  deliveriesTotal: number;
  /** Non-terminal — the work actually in flight. */
  deliveriesActive: number;
}

/** The four headline cards. One round trip, seven counts. */
export function getDashboardCounts(ctx: OrgContext): Promise<DashboardCounts> {
  return withOrgContext(ctx, async (tx) => {
    const [clientRow] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${clients.active})::int`,
      })
      .from(clients);
    const [projectRow] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        // `active` is the project STATUS a firm means by "live work", not the
        // soft-delete flag — projects use a status enum, clients use a boolean.
        active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
      })
      .from(projects);
    const [teamRow] = await tx.select({ n: count() }).from(memberships);
    // Counted here rather than by pulling rows: a firm with 300 deliveries
    // should cost one grouped query, same as the other three figures. The
    // `(org_id, state)` index covers the filter.
    const [deliveryRow] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${notInArray(designEngagements.state, TERMINAL)})::int`,
      })
      .from(designEngagements);

    return {
      clientsTotal: clientRow?.total ?? 0,
      clientsActive: clientRow?.active ?? 0,
      projectsTotal: projectRow?.total ?? 0,
      projectsActive: projectRow?.active ?? 0,
      teamMembers: teamRow?.n ?? 0,
      deliveriesTotal: deliveryRow?.total ?? 0,
      deliveriesActive: deliveryRow?.active ?? 0,
    };
  });
}

/** One month of the projects chart: how many started, split by where they got to. */
export interface ProjectsMonth extends MonthlyBucket {
  active: number;
  completed: number;
  other: number;
}

/**
 * Projects created per month over the window, split by status — the trend AND the
 * detail in one chart, which is what the spec asked for.
 *
 * Grouped in Postgres by `date_trunc('month', created_at)`. Months with no projects
 * are NOT returned here; the caller fills the gaps, because a chart that silently
 * skips an empty month draws a misleading line.
 */
export function getProjectsByMonth(
  ctx: OrgContext,
  months: RangeMonths,
): Promise<ProjectsMonth[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        month: sql<string>`to_char(date_trunc('month', ${projects.createdAt}), 'YYYY-MM')`,
        active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
        completed: sql<number>`count(*) filter (where ${projects.status} = 'completed')::int`,
        other: sql<number>`count(*) filter (where ${projects.status} not in ('active','completed'))::int`,
      })
      .from(projects)
      .where(
        gte(
          projects.createdAt,
          sql`date_trunc('month', now()) - make_interval(months => ${months - 1})`,
        ),
      )
      .groupBy(sql`date_trunc('month', ${projects.createdAt})`)
      .orderBy(sql`date_trunc('month', ${projects.createdAt})`);
    return rows;
  });
}

/** One month of the clients chart: how many were added, and how many still active. */
export interface ClientsMonth extends MonthlyBucket {
  active: number;
  inactive: number;
}

/** Clients added per month over the window, split active/inactive. Same shape and
 *  the same gap-filling contract as {@link getProjectsByMonth}. */
export function getClientsByMonth(
  ctx: OrgContext,
  months: RangeMonths,
): Promise<ClientsMonth[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        month: sql<string>`to_char(date_trunc('month', ${clients.createdAt}), 'YYYY-MM')`,
        active: sql<number>`count(*) filter (where ${clients.active})::int`,
        inactive: sql<number>`count(*) filter (where not ${clients.active})::int`,
      })
      .from(clients)
      .where(
        gte(
          clients.createdAt,
          sql`date_trunc('month', now()) - make_interval(months => ${months - 1})`,
        ),
      )
      .groupBy(sql`date_trunc('month', ${clients.createdAt})`)
      .orderBy(sql`date_trunc('month', ${clients.createdAt})`);
    return rows;
  });
}

/**
 * One in-flight delivery, as the dashboard panel needs it.
 *
 * Deliberately NOT `EngagementListRow`: that row is built for a register you
 * search (it leads with a document number and sorts newest-first). This one is
 * built for triage, so it carries the last-touched stamp the panel sorts and
 * colours by, and nothing it does not render.
 */
export interface DashboardDelivery {
  id: string;
  state: DesignState;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  /** Last write of any kind. ISO. */
  updatedAt: string;
}

/**
 * The deliveries still in flight, LONGEST UNTOUCHED FIRST.
 *
 * That ordering is the whole reason this panel is not the Deliveries table: a
 * register answers "what exists", a dashboard answers "what needs me". Capped,
 * because a panel that grows without bound stops being a summary — the header
 * links to the full list for everything past the cap.
 *
 * `updated_at` is the honest signal available for free: it moves on ANY write,
 * so it answers "has anyone touched this", not "has it advanced a stage". Good
 * enough to sort a triage list by, and the panel's wording says "since it moved"
 * rather than claiming progress.
 */
export function listDashboardDeliveries(
  ctx: OrgContext,
  limit: number,
): Promise<DashboardDelivery[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: designEngagements.id,
        state: designEngagements.state,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
        updatedAt: designEngagements.updatedAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(notInArray(designEngagements.state, TERMINAL))
      .orderBy(asc(designEngagements.updatedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  });
}
