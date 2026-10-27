import { engagementDocumentComments } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';

/** How many messages one thread read returns. A thread is a conversation, not a
 *  feed; the cap keeps a runaway thread from turning one panel read unbounded. */
const THREAD_LIMIT = 200;

/** One message as the STUDIO sees it. Unlike the client's view this keeps the
 *  author id, so the cockpit can tell "you" from a colleague. */
export interface StudioDocumentComment {
  id: string;
  channel: string;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
}

/**
 * Read ONE document's thread, oldest first. RLS scopes the read to the caller's
 * org, so a foreign artifact id simply resolves to an empty thread — the same
 * result as a document nobody has commented on. Returns `[]` on a malformed id
 * rather than throwing.
 */
export async function listDocumentCommentsCore(
  ctx: OrgContext,
  artifactId: string,
): Promise<StudioDocumentComment[]> {
  if (!isUuid(artifactId)) return [];
  return withOrgContext(ctx, async (db) =>
    db
      .select({
        id: engagementDocumentComments.id,
        channel: engagementDocumentComments.authorChannel,
        authorUserId: engagementDocumentComments.authorUserId,
        authorName: engagementDocumentComments.authorName,
        body: engagementDocumentComments.body,
        createdAt: engagementDocumentComments.createdAt,
      })
      .from(engagementDocumentComments)
      .where(eq(engagementDocumentComments.artifactId, artifactId))
      .orderBy(asc(engagementDocumentComments.createdAt))
      .limit(THREAD_LIMIT),
  );
}
