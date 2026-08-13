import 'server-only';
import { files } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ClientDocument {
  id: string;
  originalName: string | null;
  contentType: string | null;
  createdAt: string;
}

/** Files attached to a client (entity='client', entity_id=clientId), newest first. */
export function listClientDocuments(
  ctx: OrgContext,
  clientId: string,
): Promise<ClientDocument[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: files.id,
        originalName: files.originalName,
        contentType: files.contentType,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(and(eq(files.entity, 'client'), eq(files.entityId, clientId)))
      .orderBy(desc(files.createdAt));
    return rows.map((r) => ({
      id: r.id,
      originalName: r.originalName,
      contentType: r.contentType,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}
