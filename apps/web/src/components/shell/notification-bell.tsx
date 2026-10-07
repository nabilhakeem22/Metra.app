'use client';

import { Bell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { NotificationFeed } from '@/components/notifications/feed-item';
import { useNotificationFeed } from '@/components/notifications/use-notification-feed';
import { IconButton } from '@/components/ui/icon-button';
import { formatNumber } from '@/lib/format/number';
import { NotificationBellPanel } from './notification-bell-panel';

/** Past nine the pill says "9+": the number is a nudge, not a ledger. */
const BADGE_CAP = 9;

/**
 * Header bell: a COUNT of unread notifications (a pill, not a dot) and a dropdown
 * of the newest. The feed starts from the (app) layout's server read, so opening
 * the panel costs no request, and stays live through `useNotificationFeed`'s poll.
 *
 * Reading a notification never takes you away from what you were doing: marking
 * one read updates in place, and only clicking through navigates. Closes on
 * outside click and on Escape, reports its state via `aria-expanded`, and anchors
 * with logical properties so it lands on the correct corner in RTL.
 */
export function NotificationBell({ initialFeed }: { initialFeed: NotificationFeed }) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const feed = useNotificationFeed(initialFeed);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasUnread = feed.unreadCount > 0;
  const badge =
    feed.unreadCount > BADGE_CAP
      ? `${formatNumber(BADGE_CAP, locale)}+`
      : formatNumber(feed.unreadCount, locale);

  // Outside click / Escape. Bound only while OPEN, so the panel costs no document
  // listeners for the overwhelming majority of the time it is shut.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <IconButton
        aria-label={
          hasUnread
            ? t('bellWithCount', { count: formatNumber(feed.unreadCount, locale) })
            : t('bell')
        }
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell width={17} height={17} aria-hidden />
        {hasUnread && (
          <span
            data-unread-badge
            className="absolute -top-1.5 min-w-5 rounded-pill bg-brand px-1 text-center text-caption font-semibold tabular text-primary-foreground"
            style={{ insetInlineEnd: '-6px' }}
            aria-hidden
          >
            {badge}
          </span>
        )}
      </IconButton>

      {open && (
        <NotificationBellPanel
          items={feed.items}
          hasUnread={hasUnread}
          onMarkRead={feed.markRead}
          onMarkAllRead={feed.markAllRead}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
