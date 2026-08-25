'use client';

import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/icon-button';
import { Link } from '@/i18n/routing';

/**
 * Header bell linking to the notifications feed. Unread state is resolved
 * server-side (poll-on-load) and passed in; when present it shows as a small
 * danger dot at the trailing-top corner (glass top bar has no room for a count).
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const t = useTranslations('notifications');
  const hasUnread = unreadCount > 0;

  return (
    <IconButton
      asChild
      aria-label={
        hasUnread ? t('bellWithCount', { count: unreadCount }) : t('bell')
      }
    >
      <Link href="/notifications">
        <Bell width={17} height={17} aria-hidden />
        {hasUnread && (
          <span
            className="absolute size-[7px] rounded-full"
            style={{
              top: '5px',
              insetInlineEnd: '5px',
              background: 'var(--danger)',
              border: '1.5px solid rgba(255,255,255,.9)',
            }}
            aria-hidden
          />
        )}
      </Link>
    </IconButton>
  );
}
