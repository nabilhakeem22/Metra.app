'use client';

import { Check, CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import {
  notificationHref,
  type NotificationFeed,
} from '@/components/notifications/feed-item';
import { useNotificationFeed } from '@/components/notifications/use-notification-feed';
import { useNotificationText } from '@/components/notifications/use-notification-text';

/** The full feed: the same live data and wording as the bell, with more rows. */
export function NotificationsClient({ initialFeed }: { initialFeed: NotificationFeed }) {
  const t = useTranslations('notifications');
  const feed = useNotificationFeed(initialFeed);
  const text = useNotificationText();

  if (feed.items.length === 0) {
    return (
      <p className="rounded-panel border bg-muted/40 p-6 text-center text-body text-muted-foreground">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {feed.unreadCount > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={feed.markAllRead}>
            <CheckCheck className="size-4" aria-hidden />
            {t('markAll')}
          </Button>
        </div>
      )}

      <ul className="divide-y rounded-panel border bg-card">
        {feed.items.map((item) => {
          const href = notificationHref(item);
          const body = text.body(item);
          return (
            <li
              key={item.id}
              className="flex items-start gap-3 p-4 first:rounded-t-panel last:rounded-b-panel"
            >
              <span
                className={
                  item.read
                    ? 'mt-1.5 size-2 shrink-0 rounded-full bg-transparent'
                    : 'mt-1.5 size-2 shrink-0 rounded-full bg-primary'
                }
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">{text.kindLabel(item)}</p>
                {href ? (
                  <Link
                    href={href}
                    className="text-body text-muted-foreground hover:underline"
                    onClick={() => {
                      if (!item.read) feed.markRead(item.id);
                    }}
                  >
                    {body}
                  </Link>
                ) : (
                  <p className="text-body text-muted-foreground">{body}</p>
                )}
                <time dateTime={item.createdAt} className="mt-1 block text-caption text-muted-foreground">
                  {text.when(item)}
                </time>
              </div>
              {!item.read && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => feed.markRead(item.id)}
                  aria-label={t('markRead')}
                >
                  <Check className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
