import 'server-only';
import type { Notification } from '@metra/db';
import {
  BELL_FEED_LIMIT,
  type FeedItem,
  type NotificationFeed,
} from '@/components/notifications/feed-item';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { OrgContext } from '@/lib/db/context';
import { countUnread, listNotifications } from './queries';

/** One stored notification, as the feed shows it. */
function toFeedItem(row: Notification): FeedItem {
  return {
    id: row.id,
    kind: row.kind,
    bodyKey: row.bodyKey,
    params: (row.params ?? {}) as Record<string, unknown>,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
  };
}

/**
 * The caller's unread count and newest `limit` notifications, read in parallel.
 * The ONE place a notification row becomes a feed item: the shell's bell, the
 * notifications page and the poll all come through here.
 */
export async function loadNotificationFeed(
  ctx: OrgContext,
  limit: number,
): Promise<NotificationFeed> {
  const [unreadCount, rows] = await Promise.all([
    countUnread(ctx),
    listNotifications(ctx, { limit }),
  ]);
  return { unreadCount, items: rows.map(toFeedItem) };
}

/**
 * The shell's bell, which is not worth the shell: each of the two reads that
 * fails is logged and falls back on its own (no count, or no rows), so a failed
 * notification read shows a quieter bell, never an error page, and one read
 * failing keeps the other.
 */
export async function loadShellNotificationFeed(ctx: OrgContext): Promise<NotificationFeed> {
  const [unread, recent] = await Promise.allSettled([
    countUnread(ctx),
    listNotifications(ctx, { limit: BELL_FEED_LIMIT }),
  ]);
  for (const read of [unread, recent]) {
    if (read.status === 'rejected') {
      console.error('app shell: notification read failed', loggableFailure(read.reason));
    }
  }
  return {
    unreadCount: unread.status === 'fulfilled' ? unread.value : 0,
    items: recent.status === 'fulfilled' ? recent.value.map(toFeedItem) : [],
  };
}
