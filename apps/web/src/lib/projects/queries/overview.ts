import 'server-only';
import {
  activities,
  projects,
  projectStages,
  type Activity,
  type MetraDb,
  type ProjectStage,
  type ProjectStatus,
} from '@metra/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { contractedValue } from '@/lib/clients/financials';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { currentStage } from '@/lib/project-stages/queries';

export interface ProjectOverview {
  status: ProjectStatus;
  currentStage: ProjectStage | null;
  totalStages: number;
  doneStages: number;
  /** round(avg(progress_pct)) across all stages, 0 if none. */
  overallProgress: number;
  /**
   * Every committed (issued or signed) contract of this project at its revised
   * value, as its contract page shows it, plus each accepted proposal with no
   * committed contract at its total (`contractedValue`). Scale-4 money string.
   */
  contractedTotal: string;
  recentActivity: Activity[];
  // Job-costing figures are intentionally ABSENT — UI renders a locked state.
}

/** How many stages are done, and the rounded mean progress across all of them. */
function stageProgress(
  stages: ProjectStage[],
): Pick<ProjectOverview, 'doneStages' | 'overallProgress'> {
  const doneStages = stages.filter((s) => s.status === 'done').length;
  const overallProgress = stages.length
    ? Math.round(
        stages.reduce((sum, s) => sum + Number(s.progressPct), 0) /
          stages.length,
      )
    : 0;
  return { doneStages, overallProgress };
}

/** The project's five newest activity entries, newest first. */
function recentProjectActivity(tx: MetraDb, projectId: string): Promise<Activity[]> {
  return tx
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.entityType, 'project'),
        eq(activities.entityId, projectId),
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(5);
}

/** Overview figures for a project's profile: status, derived stage, progress. */
export function getProjectOverview(
  ctx: OrgContext,
  projectId: string,
): Promise<ProjectOverview> {
  return withOrgContext(ctx, async (tx) => {
    const [proj] = await tx
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const stages = await tx
      .select()
      .from(projectStages)
      .where(eq(projectStages.projectId, projectId))
      .orderBy(asc(projectStages.sortOrder), asc(projectStages.createdAt));
    const { doneStages, overallProgress } = stageProgress(stages);
    const contractedTotal = await contractedValue(tx, { column: 'projectId', id: projectId });
    const recentActivity = await recentProjectActivity(tx, projectId);
    return {
      status: proj?.status ?? 'draft',
      currentStage: currentStage(stages),
      totalStages: stages.length,
      doneStages,
      overallProgress,
      contractedTotal,
      recentActivity,
    };
  });
}
