import 'server-only';
import { files } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ProjectDocument {
  id: string;
  originalName: string | null;
  contentType: string | null;
  createdAt: string;
}

/** Files attached to a project (entity='project', entity_id=projectId), newest first. */
export function listProjectDocuments(
  ctx: OrgContext,
  projectId: string,
): Promise<ProjectDocument[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: files.id,
        originalName: files.originalName,
        contentType: files.contentType,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(and(eq(files.entity, 'project'), eq(files.entityId, projectId)))
      .orderBy(desc(files.createdAt));
    return rows.map((r) => ({
      id: r.id,
      originalName: r.originalName,
      contentType: r.contentType,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
