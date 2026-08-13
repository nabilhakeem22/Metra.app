import 'server-only';
import { projectStages, type ProjectStage } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** A project's stages, in process order. */
export function listStages(
  ctx: OrgContext,
  projectId: string,
): Promise<ProjectStage[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(projectStages)
      .where(eq(projectStages.projectId, projectId))
      .orderBy(asc(projectStages.sortOrder), asc(projectStages.createdAt)),
  );
}

/**
 * The DERIVED current stage: the in_progress one, else the first stage that is
 * neither done nor skipped by sort order. Null if all done/skipped or empty.
 */
export function currentStage(stages: ProjectStage[]): ProjectStage | null {
  const inProgress = stages.find((s) => s.status === 'in_progress');
  if (inProgress) return inProgress;
  return (
    stages.find((s) => s.status !== 'done' && s.status !== 'skipped') ?? null
  );
}
