import 'server-only';
import { designEngagements, type DesignEngagementState } from '@metra/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { EntryPhase } from '@/lib/flow/types';
import { entryPhaseOf } from './entry-phase';
import { isTerminal } from '../states';

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
  /** 'execution' for a LIGHT delivery: the client page of an execution contract (ruling D14). */
  entryPhase: EntryPhase;
  clientId: string;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: string;
}

const SUMMARY_COLUMNS = {
  id: designEngagements.id,
  number: designEngagements.number,
  state: designEngagements.state,
  entryPhase: designEngagements.entryPhase,
  clientId: designEngagements.clientId,
  titleAr: designEngagements.titleAr,
  titleEn: designEngagements.titleEn,
  createdAt: designEngagements.createdAt,
};

/** A summary row as selected. */
type SummaryRow = Omit<ProjectDeliverySummary, 'entryPhase' | 'createdAt'> & { entryPhase: string; createdAt: Date };

function summaryOf({ entryPhase, createdAt, ...row }: SummaryRow): ProjectDeliverySummary {
  return { ...row, entryPhase: entryPhaseOf(entryPhase), createdAt: createdAt.toISOString() };
}

/** How strongly a state claims the surface: active, then any non-abandoned, then abandoned. */
function surfaceRank(state: DesignEngagementState): number {
  if (!isTerminal(state)) return 2;
  return state === 'abandoned' ? 0 : 1;
}

/**
 * Does a row replace the one surfaced so far? Rows come newest-first by per-org
 * number, so a project surfaces its newest row of the highest rank: active, else
 * newest non-abandoned, else newest. An abandoned row never hides a running one.
 */
function outranks(state: DesignEngagementState, current: { state: DesignEngagementState } | null | undefined): boolean {
  return !current || surfaceRank(state) > surfaceRank(current.state);
}

/**
 * The Project's current Delivery, or null if it has none (outranks). Reads via
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
      .select(SUMMARY_COLUMNS)
      .from(designEngagements)
      .where(eq(designEngagements.projectId, projectId))
      .orderBy(desc(designEngagements.number));
    let current: SummaryRow | null = null;
    for (const row of rows) {
      if (outranks(row.state, current)) current = row;
    }
    return current && summaryOf(current);
  });
}

/**
 * The current Delivery for EACH of many projects in ONE round-trip (Slice C4) — the
 * batch form of `getEngagementByProject`, for the client Projects tab where a per-row
 * read would be an N+1. One query (`where project_id in (...)`, ordered by project then
 * `number` descending), reduced per project with the SAME rule (outranks). Returns a
 * map keyed by projectId with `null` for a project that has no delivery in-org; empty
 * input reads `{}`. Reads via `design_engagements_org_project_idx`; RLS scopes it to
 * the caller's org (a foreign project is absent from the map). The CALLER gates the
 * read on the `engagements_design` read capability.
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
      .select({ ...SUMMARY_COLUMNS, projectId: designEngagements.projectId })
      .from(designEngagements)
      .where(inArray(designEngagements.projectId, projectIds))
      .orderBy(asc(designEngagements.projectId), desc(designEngagements.number));

    for (const { projectId, ...row } of rows) {
      if (outranks(row.state, result[projectId])) result[projectId] = summaryOf(row);
    }
    return result;
  });
}
