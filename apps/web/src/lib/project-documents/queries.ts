import 'server-only';
import { documentCategories, files } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ProjectDocument {
  id: string;
  originalName: string | null;
  contentType: string | null;
  createdAt: string;
  /** The firm's filing category, or null for a document filed before categories
   *  existed (or deliberately left uncategorised). The tab groups on this. */
  categoryId: string | null;
  categoryNameEn: string | null;
  categoryNameAr: string | null;
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
        categoryId: files.categoryId,
        categoryNameEn: documentCategories.nameEn,
        categoryNameAr: documentCategories.nameAr,
      })
      .from(files)
      // LEFT so an uncategorised document is still listed.
      .leftJoin(documentCategories, eq(documentCategories.id, files.categoryId))
      .where(and(eq(files.entity, 'project'), eq(files.entityId, projectId)))
      .orderBy(desc(files.createdAt));
    return rows.map((r) => ({
      id: r.id,
      originalName: r.originalName,
      contentType: r.contentType,
      createdAt: r.createdAt.toISOString(),
      categoryId: r.categoryId,
      categoryNameEn: r.categoryNameEn,
      categoryNameAr: r.categoryNameAr,
    }));
  });
}
