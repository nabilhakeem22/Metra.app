'use client';

import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

/**
 * Header bell linking to the notifications feed. The unread badge is resolved
 * server-side (poll-on-load) and passed in; caps the label at 9+ to stay compact.
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const t = useTranslations('notifications');
  const hasUnread = unreadCount > 0;
  const label = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <Link
      href="/notifications"
      aria-label={
        hasUnread ? t('bellWithCount', { count: unreadCount }) : t('bell')
      }
      className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Bell className="size-5" aria-hidden />
      {hasUnread && (
        <span
          className="absolute -top-0.5 -end-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
          aria-hidden
        >
          {label}
        </span>
      )}
    </Link>
  );
}
