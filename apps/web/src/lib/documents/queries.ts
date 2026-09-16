import 'server-only';
import { documentCategories, files } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { DocumentEntitySpec } from './entities';

/** A file stapled to a client or a project, as the documents tab renders it. */
export interface EntityDocument {
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

/** The tab's columns, as DATA. Storage bucket and object key stay server-side. */
const DOCUMENT_COLUMNS = {
  id: files.id,
  originalName: files.originalName,
  contentType: files.contentType,
  createdAt: files.createdAt,
  categoryId: files.categoryId,
  categoryNameEn: documentCategories.nameEn,
  categoryNameAr: documentCategories.nameAr,
} as const;

/** Files attached to one parent row (entity + entity_id), newest first. */
export function listDocuments(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  parentId: string,
): Promise<EntityDocument[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select(DOCUMENT_COLUMNS)
      .from(files)
      // LEFT so an uncategorised document is still listed.
      .leftJoin(documentCategories, eq(documentCategories.id, files.categoryId))
      .where(and(eq(files.entity, spec.entity), eq(files.entityId, parentId)))
      .orderBy(desc(files.createdAt));
    return rows.map(({ createdAt, ...rest }) => ({
      ...rest,
      createdAt: createdAt.toISOString(),
    }));
  });
}
