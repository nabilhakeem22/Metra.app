// What a poll does to the feed already on screen. PURE and CLIENT-SAFE.
//
// A poll reads only the newest `pollLimit`, but the notifications page shows
// more than that. So the polled items lead (new ones, and a repeat that moved to
// the top with its count bumped), and every OLDER item already shown that the
// poll did not reach stays under them. A poll that came back short of its limit
// saw everything there is, and is the whole truth.
import type { NotificationFeed } from './feed-item';

export function mergeNotificationFeed(
  shown: NotificationFeed,
  polled: NotificationFeed,
  pollLimit: number,
): NotificationFeed {
  if (polled.items.length < pollLimit) return polled;
  const polledIds = new Set(polled.items.map((item) => item.id));
  const oldestPolled = polled.items[polled.items.length - 1].createdAt;
  const olderShown = shown.items.filter(
    (item) => !polledIds.has(item.id) && item.createdAt <= oldestPolled,
  );
  const length = Math.max(shown.items.length, polled.items.length);
  return {
    unreadCount: polled.unreadCount,
    items: [...polled.items, ...olderShown].slice(0, length),
  };
}
