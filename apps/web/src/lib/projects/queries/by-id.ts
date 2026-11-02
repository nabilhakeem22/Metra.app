import 'server-only';
import { projects, projectTypes, type Project } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

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
