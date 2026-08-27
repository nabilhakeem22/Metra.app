import 'server-only';
import { designEngagements, type DesignEngagementState } from '@metra/db';
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { TERMINAL_STATES } from '../states';

/**
 * The one Delivery a Project surface links to: its current DE (id + rendered-number
 * inputs + lifecycle state + bilingual title). This is the through-project entry
 * point (Slice C2) — a Project reaches its Delivery, so the surface can show
 * "Open delivery" (with the stage badge) or "Start delivery". Timestamps cross the
 * server -> client boundary as ISO strings. RLS scopes the read to the caller's org.
 */
export interface ProjectDeliverySummary {
  id: string;
  number: number;
  state: DesignEngagementState;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: string;
}

/**
 * The Project's current Delivery, or null if it has none. A Project has at most one
 * ACTIVE (non-terminal) Delivery at a time (the one-delivery guard in
 * `createEngagementCore` enforces it), so the ACTIVE one is preferred when present;
 * otherwise the most-recent by per-org `number` (a project whose only Deliveries are
 * TERMINAL surfaces the newest closed one). Reads via
 * `design_engagements_org_project_idx`; RLS scopes it to the caller's org (a foreign
 * project reads as null). The CALLER gates the read on the `engagements_design` read
 * capability.
 */
export function getEngagementByProject(
  ctx: OrgContext,
  projectId: string,
): Promise<ProjectDeliverySummary | null> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        state: designEngagements.state,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        createdAt: designEngagements.createdAt,
      })
      .from(designEngagements)
      .where(eq(designEngagements.projectId, projectId))
      .orderBy(desc(designEngagements.number));

    // Rows are newest-first by per-org number, so the first non-terminal row is the
    // highest-numbered ACTIVE Delivery; falling back to rows[0] yields the newest
    // Delivery overall when every one is terminal.
    const current =
      rows.find((row) => !TERMINAL_STATES.has(row.state)) ?? rows[0] ?? null;
    if (!current) return null;
    return { ...current, createdAt: current.createdAt.toISOString() };
  });
}

/**
 * The current Delivery for EACH of many projects in ONE round-trip (Slice C4) — the
 * batch form of `getEngagementByProject`, for the client Projects tab where a per-row
 * read would be an N+1. One query (`where project_id in (...)`, ordered by project then
 * `number` descending), reduced per project with the SAME rule as
 * `getEngagementByProject`: the first NON-terminal delivery is the highest-numbered
 * ACTIVE one; falling back to the newest overall surfaces the latest closed one when
 * every delivery is terminal. Returns a map keyed by projectId with `null` for a
 * project that has no delivery in-org; empty input reads `{}`. Reads via
 * `design_engagements_org_project_idx`; RLS scopes it to the caller's org (a foreign
 * project is absent from the map). The CALLER gates the read on the `engagements_design`
 * read capability.
 */
export function getDeliveriesByProjects(
  ctx: OrgContext,
  projectIds: string[],
): Promise<Record<string, ProjectDeliverySummary | null>> {
  return withOrgContext(ctx, async (tx) => {
    const result: Record<string, ProjectDeliverySummary | null> = {};
    for (const projectId of projectIds) result[projectId] = null;
    if (projectIds.length === 0) return result;

    const rows = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        state: designEngagements.state,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        createdAt: designEngagements.createdAt,
        projectId: designEngagements.projectId,
      })
      .from(designEngagements)
      .where(inArray(designEngagements.projectId, projectIds))
      .orderBy(
        asc(designEngagements.projectId),
        desc(designEngagements.number),
      );

    // Rows are grouped by project, newest-first by per-org number within each group.
    // For each project the first NON-terminal row is its highest-numbered ACTIVE
    // delivery; if none is active, the first row seen for that project is the newest
    // overall (a fully-terminal project surfaces its latest closed one). Mirrors the
    // "active-preferred, else most-recent" logic in `getEngagementByProject`.
    for (const row of rows) {
      const existing = result[row.projectId];
      if (existing && !TERMINAL_STATES.has(existing.state)) continue;
      if (existing && TERMINAL_STATES.has(row.state)) continue;
      const { projectId, ...summary } = row;
      result[projectId] = { ...summary, createdAt: row.createdAt.toISOString() };
    }

    return result;
  });
}

/**
 * How many deliveries count toward a project's lifetime cap (Slice C2-hardening):
 * the number of NON-abandoned deliveries. Predicate is `state <> 'abandoned'`
 * (owner decision) — abandoned deliveries never count, so a project with 1 real +
 * N abandoned rows still reads 1 and can start its extension. The create-time cap
 * check (`createEngagementCore`) inlines the same predicate inside its own tx to
 * avoid a second round-trip; this query feeds the project delivery panel. RLS
 * scopes the read to the caller's org (a foreign project reads as 0). The CALLER
 * gates the read on the `engagements_design` read capability.
 */
export function countProjectDeliveries(
  ctx: OrgContext,
  projectId: string,
): Promise<number> {
  return withOrgContext(ctx, async (tx) => {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(designEngagements)
      .where(
        and(
          eq(designEngagements.projectId, projectId),
          ne(designEngagements.state, 'abandoned'),
        ),
      );
    return value;
  });
}
