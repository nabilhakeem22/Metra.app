import 'server-only';
import { designEngagements, projects, type DesignEngagementState } from '@metra/db';
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
  /** Whose project it is now: read with the row, so preferring them costs no statement. */
  projectClientId: projects.clientId,
};

/** A summary row as selected. */
type SummaryRow = Omit<ProjectDeliverySummary, 'entryPhase' | 'createdAt'> & {
  entryPhase: string;
  createdAt: Date;
  projectClientId: string | null;
};

function summaryOf({ entryPhase, createdAt, projectClientId: _projectClient, ...row }: SummaryRow): ProjectDeliverySummary {
  return { ...row, entryPhase: entryPhaseOf(entryPhase), createdAt: createdAt.toISOString() };
}

/**
 * How strongly a row claims the surface: active, then the project client's
 * finished row, then another client's, then abandoned.
 */
function surfaceRank(row: Pick<SummaryRow, 'state' | 'clientId' | 'projectClientId'>): number {
  if (!isTerminal(row.state)) return 3;
  if (row.state === 'abandoned') return 0;
  return row.clientId === row.projectClientId ? 2 : 1;
}

/**
 * Does a row replace the one surfaced so far? Rows come newest-first by per-org
 * number, so a project surfaces its newest row of the highest rank. An abandoned
 * row never hides a running one, and the project's client always finds their own
 * row, whatever a former client's newer one holds.
 */
function outranks(row: SummaryRow, current: SummaryRow | null | undefined): boolean {
  return !current || surfaceRank(row) > surfaceRank(current);
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
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(eq(designEngagements.projectId, projectId))
      .orderBy(desc(designEngagements.number));
    let current: SummaryRow | null = null;
    for (const row of rows) {
      if (outranks(row, current)) current = row;
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
    const shown: Record<string, SummaryRow | null> = {};
    for (const projectId of projectIds) shown[projectId] = null;
    if (projectIds.length === 0) return {};

    const rows = await tx
      .select({ ...SUMMARY_COLUMNS, projectId: designEngagements.projectId })
      .from(designEngagements)
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(inArray(designEngagements.projectId, projectIds))
      .orderBy(asc(designEngagements.projectId), desc(designEngagements.number));

    for (const { projectId, ...row } of rows) {
      if (outranks(row, shown[projectId])) shown[projectId] = row;
    }
    return Object.fromEntries(Object.entries(shown).map(([projectId, row]) => [projectId, row && summaryOf(row)]));
  });
}
