import 'server-only';
// Reads for the firm's document filing vocabulary.
import { documentCategories, type DocumentCategory } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** Every category, active first-class and retired ones included — the Settings
 *  screen needs to show and re-activate a retired one. Display order. */
export function listDocumentCategories(
  ctx: OrgContext,
): Promise<DocumentCategory[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(documentCategories)
      .orderBy(asc(documentCategories.sortOrder), asc(documentCategories.createdAt)),
  );
}

/** Only the categories a document may currently be filed under — what the upload
 *  picker offers. A retired category keeps its existing documents but takes no new
 *  ones. */
export function listActiveDocumentCategories(
  ctx: OrgContext,
): Promise<DocumentCategory[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(documentCategories)
      .where(eq(documentCategories.active, true))
      .orderBy(asc(documentCategories.sortOrder), asc(documentCategories.createdAt)),
  );
}
