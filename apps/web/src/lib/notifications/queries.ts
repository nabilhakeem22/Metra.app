import 'server-only';
import { notifications, type Notification } from '@metra/db';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * The caller's notifications (recipient = ctx.userId — also enforced by RLS),
 * newest first. `before` paginates by created_at (poll-on-load feed).
 */
export function listNotifications(
  ctx: OrgContext,
  opts: { limit?: number; before?: Date } = {},
): Promise<Notification[]> {
  const limit = opts.limit ?? 30;
  return withOrgContext(ctx, (tx) => {
    const conds = [eq(notifications.recipientUserId, ctx.userId)];
    if (opts.before) conds.push(lt(notifications.createdAt, opts.before));
    return tx
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  });
}

/** How many unread notifications the caller has (for the header bell badge). */
export function countUnread(ctx: OrgContext): Promise<number> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, ctx.userId),
          isNull(notifications.readAt),
        ),
      );
    return Number(row?.n ?? 0);
  });
}
