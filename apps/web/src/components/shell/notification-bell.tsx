'use client';

import { Bell, Check, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  notificationBody,
  notificationHref,
  type FeedItem,
} from '@/components/notifications/feed-item';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/hooks/use-toast';
import { Link, useRouter } from '@/i18n/routing';
import { formatDate } from '@/lib/format/date';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notifications/actions';

/**
 * Header bell with a dropdown of the most recent notifications.
 *
 * The items come down from the (app) layout, which is a server component that was
 * already counting unread — so opening the panel costs no request and can never be
 * staler than the page it sits on.
 *
 * The point of a dropdown over the previous link-to-page bell is that reading a
 * notification no longer takes you away from what you were doing: marking one read
 * refreshes in place, and only clicking through navigates.
 *
 * Closes on outside click and on Escape, reports its state via `aria-expanded`, and
 * anchors with logical properties so it lands on the correct corner in RTL.
 */
export function NotificationBell({
  unreadCount,
  items,
}: {
  unreadCount: number;
  /** The most recent notifications, newest first. */
  items: FeedItem[];
}) {
  const t = useTranslations('notifications');
  const tb = useTranslations('notifications.body');
  const tk = useTranslations('notifications.kinds');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const hasUnread = unreadCount > 0;

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

  function run(fn: () => Promise<{ ok: boolean }>): void {
    start(async () => {
      // Wrapped so a rejected action can never leave the panel spinning.
      try {
        const res = await fn();
        if (res.ok) router.refresh();
        else toast({ title: t('markFailed'), variant: 'destructive' });
      } catch {
        toast({ title: t('markFailed'), variant: 'destructive' });
      }
    });
  }

  return (
    <div className="relative" ref={rootRef}>
      <IconButton
        aria-label={hasUnread ? t('bellWithCount', { count: unreadCount }) : t('bell')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
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
      </IconButton>

      {open && (
        <div
          className="absolute z-50 mt-2 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card shadow-lg"
          style={{ insetInlineEnd: 0 }}
          role="menu"
          aria-label={t('title')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[color:var(--rule)] px-3 py-2">
            <p className="text-sm font-semibold">{t('title')}</p>
            {hasUnread && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(markAllNotificationsRead)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-3" aria-hidden />
                )}
                {t('markAll')}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-[color:var(--rule)] overflow-y-auto">
              {items.map((item) => {
                const href = notificationHref(item);
                const body = notificationBody(item, tb, (iso) => formatDate(iso, locale));
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
                      <p className="text-xs font-medium">{tk(item.kind)}</p>
                      {body && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-muted-foreground" dir="ltr">
                        {formatDate(item.createdAt, locale)}
                      </p>
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
                          setOpen(false);
                          if (!item.read) run(() => markNotificationRead(item.id));
                        }}
                      >
                        {inner}
                      </Link>
                    ) : (
                      // Nothing to open, so the row's only job is "mark this read".
                      <button
                        type="button"
                        role="menuitem"
                        disabled={item.read || pending}
                        onClick={() => run(() => markNotificationRead(item.id))}
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
            onClick={() => setOpen(false)}
            className="block border-t border-[color:var(--rule)] px-3 py-2 text-center text-xs font-medium text-brand-ink hover:bg-muted/50"
          >
            {t('viewAll')}
          </Link>
        </div>
      )}
    </div>
  );
}
