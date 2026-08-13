import 'server-only';
import { projectTypes, type ProjectType } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** Active project types, ordered by sort then name. */
export function listProjectTypes(ctx: OrgContext): Promise<ProjectType[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(projectTypes)
      .where(eq(projectTypes.active, true))
      .orderBy(asc(projectTypes.sortOrder), asc(projectTypes.nameEn)),
  );
}
