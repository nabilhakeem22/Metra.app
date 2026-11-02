import { engagementDocumentComments, type MetraDb } from '@metra/db';
import { and, count, eq, gt, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';

/** The comments table aliased `later`: a LATER message on the same document. */
type LaterComment = ReturnType<typeof alias<typeof engagementDocumentComments, 'later'>>;

/** A staff message on the SAME document as the outer row, written after it. */
function laterStaffReply(tx: MetraDb, later: LaterComment) {
  return tx
    .select({ one: sql`1` })
    .from(later)
    .where(
      and(
        eq(later.artifactId, engagementDocumentComments.artifactId),
        eq(later.orgId, engagementDocumentComments.orgId),
        eq(later.authorChannel, 'staff'),
        gt(later.createdAt, engagementDocumentComments.createdAt),
      ),
    );
}

/**
 * How many client messages on this engagement are still AWAITING a studio reply —
 * a client message with no staff message after it on the same document.
 *
 * DERIVED, not stored: the comments table is append-only (SELECT + INSERT grants
 * only), so there is no `seen_at` to flip. That is deliberate twice over — a read
 * flag would need an UPDATE grant on an immutable ledger, and "awaiting reply" is a
 * truer signal to the studio than "somebody opened it". Opening a thread therefore
 * does NOT clear the badge; replying does.
 *
 * Counts messages, not documents: three unanswered questions on one drawing read as
 * three, which is what the studio has to work through.
 */
export async function countAwaitingReplyCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<number> {
  if (!isUuid(engagementId)) return 0;
  // The same table again, aliased, so the subquery can refer to a LATER message on
  // the same document without colliding with the outer row.
  const later = alias(engagementDocumentComments, 'later');
  const [row] = await withOrgContext(ctx, async (db) =>
    db
      .select({ n: count() })
      .from(engagementDocumentComments)
      .where(
        and(
          eq(engagementDocumentComments.engagementId, engagementId),
          eq(engagementDocumentComments.authorChannel, 'client'),
          // ...and no staff message on the SAME document after it.
          notExists(laterStaffReply(db, later)),
        ),
      ),
  );
  return row?.n ?? 0;
}
