'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ALL_MILESTONE_KINDS } from '@/lib/engagements/default-fee-split';
import { formatDate } from '@/lib/format/date';
import { formatRelativeTime } from '@/lib/format/relative-time';
import { notificationBody, type FeedItem } from './feed-item';

/**
 * How the bell and the notifications page word one item: its kind, its sentence,
 * and when it happened ("3 hours ago", Latin digits in both locales), every row
 * measured against the same instant of this render.
 */
export function useNotificationText(): {
  kindLabel: (item: FeedItem) => string;
  body: (item: FeedItem) => string;
  when: (item: FeedItem) => string;
} {
  const tk = useTranslations('notifications.kinds');
  const tb = useTranslations('notifications.body');
  const tm = useTranslations('engagements.milestoneKind');
  const locale = useLocale();
  const nowMs = Date.now();
  const milestoneLabel = (kind: string) =>
    (ALL_MILESTONE_KINDS as readonly string[]).includes(kind) ? tm(kind) : null;
  return {
    kindLabel: (item) => tk(item.kind),
    body: (item) =>
      notificationBody(item, tb, (iso) => formatDate(iso, locale), locale, milestoneLabel),
    when: (item) => formatRelativeTime(item.createdAt, nowMs, locale),
  };
}
