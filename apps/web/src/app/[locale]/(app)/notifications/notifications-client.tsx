'use client';

import { Check, CheckCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useRouter, Link } from '@/i18n/routing';
import { formatDate } from '@/lib/format/date';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notifications/actions';

export interface FeedItem {
  id: string;
  kind: string;
  bodyKey: string;
  params: Record<string, unknown>;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  read: boolean;
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  proposal: (id) => `/proposals/${id}`,
  project: (id) => `/projects/${id}`,
};

export function NotificationsClient({ items }: { items: FeedItem[] }) {
  const t = useTranslations('notifications');
  const tk = useTranslations('notifications.kinds');
  const tb = useTranslations('notifications.body');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  const hasUnread = items.some((i) => !i.read);

  // Numeric params are passed as STRINGS so next-intl never applies locale number
  // formatting (which would emit Arabic-Indic digits for ar-EG) — Western only.
  function body(item: FeedItem): string {
    const p = item.params;
    const s = (v: unknown) => String(v ?? 0);
    switch (item.bodyKey) {
      case 'proposal_expiring':
        return tb('proposal_expiring', {
          number: s(p.number),
          date: formatDate(String(p.expiryDate ?? ''), locale),
        });
      case 'proposal_followup':
        return tb('proposal_followup', {
          number: s(p.number),
          days: s(p.days),
        });
      case 'portfolio_digest':
        return tb('portfolio_digest', {
          active: s(p.activeProjects),
          awaiting: s(p.awaitingResponse),
          expiring: s(p.expiringSoon),
          overdue: s(p.overdueStages),
        });
      case 'stage_reminder':
        return tb('stage_reminder', {
          overdue: s(p.overdueCount),
          upcoming: s(p.upcomingCount),
        });
      default:
        return '';
    }
  }

  function markOne(id: string) {
    start(async () => {
      const res = await markNotificationRead(id);
      if (res.ok) router.refresh();
      else toast({ title: t('markFailed'), variant: 'destructive' });
    });
  }

  function markAll() {
    start(async () => {
      const res = await markAllNotificationsRead();
      if (res.ok) router.refresh();
      else toast({ title: t('markFailed'), variant: 'destructive' });
    });
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {hasUnread && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={markAll} disabled={pending}>
            <CheckCheck className="size-4" aria-hidden />
            {t('markAll')}
          </Button>
        </div>
      )}

      <ul className="divide-y rounded-xl border bg-card">
        {items.map((item) => {
          const hrefFn = item.entityType
            ? ENTITY_HREF[item.entityType]
            : undefined;
          const href = hrefFn && item.entityId ? hrefFn(item.entityId) : null;
          const text = body(item);
          return (
            <li
              key={item.id}
              className="flex items-start gap-3 p-4 first:rounded-t-xl last:rounded-b-xl"
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
                <p className="text-sm font-medium">{tk(item.kind)}</p>
                {href ? (
                  <Link
                    href={href}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    {text}
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">{text}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(item.createdAt, locale)}
                </p>
              </div>
              {!item.read && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => markOne(item.id)}
                  disabled={pending}
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
