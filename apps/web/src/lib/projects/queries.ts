import 'server-only';
import {
  activities,
  clients,
  projects,
  projectStages,
  projectTypes,
  proposals,
  type Activity,
  type Project,
  type ProjectStage,
  type ProjectStatus,
} from '@metra/db';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { currentStage } from '@/lib/project-stages/queries';

export interface ListProjectsFilter {
  status?: ProjectStatus;
  clientId?: string;
  active?: boolean;
  q?: string;
}

export interface ProjectRow {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  clientNameEn: string | null;
  clientNameAr: string | null;
}

/** Org-scoped projects with the client name joined in, optionally filtered. */
export function listProjects(
  ctx: OrgContext,
  filter: ListProjectsFilter = {},
): Promise<ProjectRow[]> {
  return withOrgContext(ctx, (tx) => {
    const conds = [];
    if (filter.status) conds.push(eq(projects.status, filter.status));
    if (filter.clientId) conds.push(eq(projects.clientId, filter.clientId));
    if (filter.active !== undefined) conds.push(eq(projects.active, filter.active));
    if (filter.q && filter.q.trim()) {
      const pattern = `%${filter.q.trim()}%`;
      conds.push(
        or(
          ilike(projects.code, pattern),
          ilike(projects.nameEn, pattern),
          ilike(projects.nameAr, pattern),
        ),
      );
    }
    return tx
      .select({
        id: projects.id,
        code: projects.code,
        nameEn: projects.nameEn,
        nameAr: projects.nameAr,
        clientId: projects.clientId,
        status: projects.status,
        startDate: projects.startDate,
        endDate: projects.endDate,
        city: projects.city,
        address: projects.address,
        notes: projects.notes,
        active: projects.active,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
      })
      .from(projects)
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(projects.code));
  });
}

export interface ProjectWithType extends Project {
  typeNameEn: string | null;
  typeNameAr: string | null;
}

/** One project by id (org-scoped) with its resolved type name. Null if absent. */
export function getProjectById(
  ctx: OrgContext,
  id: string,
): Promise<ProjectWithType | null> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        project: projects,
        typeNameEn: projectTypes.nameEn,
        typeNameAr: projectTypes.nameAr,
      })
      .from(projects)
      .leftJoin(projectTypes, eq(projectTypes.id, projects.typeId))
      .where(eq(projects.id, id))
      .limit(1);
    if (!row) return null;
    return {
      ...row.project,
      typeNameEn: row.typeNameEn,
      typeNameAr: row.typeNameAr,
    };
  });
}

export interface ProjectOverview {
  status: ProjectStatus;
  currentStage: ProjectStage | null;
  totalStages: number;
  doneStages: number;
  /** round(avg(progress_pct)) across all stages, 0 if none. */
  overallProgress: number;
  /** Sum of ACCEPTED proposal totals for this project (scale-4 money string). */
  contractedTotal: string;
  recentActivity: Activity[];
  // Job-costing figures are intentionally ABSENT — UI renders a locked state.
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

    const doneStages = stages.filter((s) => s.status === 'done').length;
    const overallProgress = stages.length
      ? Math.round(
          stages.reduce((sum, s) => sum + Number(s.progressPct), 0) /
            stages.length,
        )
      : 0;

    const [contractedRow] = await tx
      .select({ total: sql<string>`coalesce(sum(${proposals.total}), 0)::text` })
      .from(proposals)
      .where(
        and(
          eq(proposals.projectId, projectId),
          eq(proposals.status, 'accepted'),
        ),
      );

    const recentActivity = await tx
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

    return {
      status: proj?.status ?? 'draft',
      currentStage: currentStage(stages),
      totalStages: stages.length,
      doneStages,
      overallProgress,
      contractedTotal: contractedRow?.total ?? '0',
      recentActivity,
    };
  });
}
