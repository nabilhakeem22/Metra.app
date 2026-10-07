'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { NotificationFeed } from './feed-item';
import { useNotificationFeed, type NotificationFeedApi } from './use-notification-feed';

const NotificationFeedContext = createContext<NotificationFeedApi | null>(null);

/**
 * The ONE live notification feed of the signed-in shell. The bell and the
 * notifications page both read it, so a tab polls once a minute however many
 * places show notifications, and marking one read anywhere is read everywhere.
 */
export function NotificationFeedProvider({
  initialFeed,
  children,
}: {
  initialFeed: NotificationFeed;
  children: ReactNode;
}) {
  const feed = useNotificationFeed(initialFeed);
  return <NotificationFeedContext.Provider value={feed}>{children}</NotificationFeedContext.Provider>;
}

export function useSharedNotificationFeed(): NotificationFeedApi {
  const feed = useContext(NotificationFeedContext);
  if (!feed) throw new Error('useSharedNotificationFeed outside NotificationFeedProvider');
  return feed;
}
