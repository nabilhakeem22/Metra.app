import { describe, expect, it } from 'vitest';
import type { FeedItem } from './feed-item';
import { mergeNotificationFeed } from './merge-feed';

const item = (id: string, minute: number, read = false): FeedItem => ({
  id,
  kind: 'client_responded',
  bodyKey: 'client_commented',
  params: {},
  entityType: 'engagement',
  entityId: 'e-1',
  createdAt: `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`,
  read,
});

describe('mergeNotificationFeed', () => {
  it('a short poll saw everything and replaces the feed', () => {
    const shown = { unreadCount: 2, items: [item('b', 2), item('a', 1)] };
    const polled = { unreadCount: 0, items: [item('b', 2, true)] };
    expect(mergeNotificationFeed(shown, polled, 2)).toEqual(polled);
  });

  it('a full poll leads; older shown items it did not reach stay under it, at the shown length', () => {
    const shown = {
      unreadCount: 1,
      items: [item('d', 4), item('c', 3), item('b', 2), item('a', 1)],
    };
    // A new one (e), and c repeated: moved to the top.
    const polled = { unreadCount: 2, items: [item('c', 6), item('e', 5)] };
    const merged = mergeNotificationFeed(shown, polled, 2);
    expect(merged.unreadCount).toBe(2);
    expect(merged.items.map((entry) => entry.id)).toEqual(['c', 'e', 'd', 'b']);
  });

  it('never grows past what was shown unless the poll itself is longer', () => {
    const shown = { unreadCount: 0, items: [item('a', 1)] };
    const polled = { unreadCount: 2, items: [item('c', 3), item('b', 2)] };
    expect(mergeNotificationFeed(shown, polled, 2).items.map((entry) => entry.id)).toEqual(['c', 'b']);
  });
});
