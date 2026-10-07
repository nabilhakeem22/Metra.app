'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { notificationHref, type FeedItem } from '@/components/notifications/feed-item';
import { useNotificationText } from '@/components/notifications/use-notification-text';
import { Link } from '@/i18n/routing';

/**
 * The bell's dropdown: the newest notifications, "Mark all read", and a way to
 * the full page. A row that points somewhere opens it (and marks it read); a row
 * that points nowhere only marks itself read.
 */
export function NotificationBellPanel({
  items,
  hasUnread,
  onMarkRead,
  onMarkAllRead,
  onClose,
}: {
  items: FeedItem[];
  hasUnread: boolean;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('notifications');
  const text = useNotificationText();

  return (
    <div
      className="absolute z-50 mt-2 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-panel border border-[color:var(--rule)] bg-card shadow-lg"
      style={{ insetInlineEnd: 0 }}
      role="menu"
      aria-label={t('title')}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--rule)] px-3 py-2">
        <p className="text-body font-semibold">{t('title')}</p>
        {hasUnread && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
          >
            <Check className="size-3" aria-hidden />
            {t('markAll')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-body text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="max-h-80 divide-y divide-[color:var(--rule)] overflow-y-auto">
          {items.map((item) => {
            const href = notificationHref(item);
            const body = text.body(item);
            const inner = (
              <div className="flex items-start gap-2">
                {/* An unread DOT rather than a tinted row: the panel is small and
                    a block of colour would drown the text it is marking. */}
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                    item.read ? 'bg-transparent' : 'bg-[color:var(--danger)]'
                  }`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-caption font-medium">{text.kindLabel(item)}</p>
                  {body && <p className="mt-0.5 text-caption text-muted-foreground">{body}</p>}
                  <time
                    dateTime={item.createdAt}
                    className="mt-0.5 block text-caption text-muted-foreground"
                  >
                    {text.when(item)}
                  </time>
                </div>
              </div>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link
                    href={href}
                    role="menuitem"
                    className="block px-3 py-2.5 hover:bg-muted/50"
                    onClick={() => {
                      onClose();
                      if (!item.read) onMarkRead(item.id);
                    }}
                  >
                    {inner}
                  </Link>
                ) : (
                  // Nothing to open, so the row's only job is "mark this read".
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.read}
                    onClick={() => onMarkRead(item.id)}
                    className="block w-full px-3 py-2.5 text-start hover:bg-muted/50 disabled:hover:bg-transparent"
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/notifications"
        onClick={onClose}
        className="block border-t border-[color:var(--rule)] px-3 py-2 text-center text-caption font-medium text-brand-ink hover:bg-muted/50"
      >
        {t('viewAll')}
      </Link>
    </div>
  );
}
