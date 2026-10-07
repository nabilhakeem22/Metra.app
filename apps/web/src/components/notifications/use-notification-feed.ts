'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  markAllNotificationsRead,
  markNotificationRead,
  pollNotificationFeed,
} from '@/lib/notifications/actions';
import { BELL_FEED_LIMIT, type FeedItem, type NotificationFeed } from './feed-item';
import { mergeNotificationFeed } from './merge-feed';

/** One poll a minute, and only while someone can see the tab. */
export const NOTIFICATION_POLL_MS = 60_000;

const isTabVisible = () => document.visibilityState === 'visible';

/**
 * The notification feed, kept live. It starts from what the server rendered and
 * adopts any newer server render (a refresh after a mark). While the tab is
 * visible it polls every minute, and at once when the tab comes back into view or
 * the window regains focus; a hidden tab sends nothing. Never two polls at once;
 * a failed poll keeps what is on screen, silently. Marking read changes the
 * screen first, then tells the server; a refusal says so and re-polls the truth.
 */
export function useNotificationFeed(initialFeed: NotificationFeed): {
  unreadCount: number;
  items: FeedItem[];
  markRead: (id: string) => void;
  markAllRead: () => void;
} {
  const t = useTranslations('notifications');
  const [feed, setFeed] = useState(initialFeed);
  const [adoptedFeed, setAdoptedFeed] = useState(initialFeed);
  if (initialFeed !== adoptedFeed) {
    setAdoptedFeed(initialFeed);
    setFeed(initialFeed);
  }
  const polling = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const result = await pollNotificationFeed();
      if (result.ok) {
        setFeed((shown) => mergeNotificationFeed(shown, result.data, BELL_FEED_LIMIT));
      }
    } catch {
      // A transport failure is as silent as a refused poll: keep what is shown.
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      interval ??= setInterval(() => void poll(), NOTIFICATION_POLL_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibilityChange = () => {
      stop();
      if (!isTabVisible()) return;
      void poll();
      start();
    };
    const onFocus = () => {
      if (isTabVisible()) void poll();
    };
    if (isTabVisible()) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [poll]);

  async function tellServer(mark: () => Promise<{ ok: boolean }>): Promise<void> {
    let ok = false;
    try {
      ok = (await mark()).ok;
    } catch {
      ok = false;
    }
    if (ok) return;
    toast({ title: t('markFailed'), variant: 'destructive' });
    await poll();
  }

  function markRead(id: string): void {
    setFeed((shown) => ({
      unreadCount: Math.max(
        0,
        shown.unreadCount - (shown.items.some((item) => item.id === id && !item.read) ? 1 : 0),
      ),
      items: shown.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    }));
    void tellServer(() => markNotificationRead(id));
  }

  function markAllRead(): void {
    setFeed((shown) => ({
      unreadCount: 0,
      items: shown.items.map((item) => ({ ...item, read: true })),
    }));
    void tellServer(markAllNotificationsRead);
  }

  return { unreadCount: feed.unreadCount, items: feed.items, markRead, markAllRead };
}
