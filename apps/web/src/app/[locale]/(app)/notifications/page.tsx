import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { loadNotificationFeed } from '@/lib/notifications/feed';
import { NotificationsClient } from './notifications-client';

/** The page shows more than the bell; its poll refreshes the newest of them. */
const PAGE_FEED_LIMIT = 50;

export default async function NotificationsPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('notifications');

  const feed = await loadNotificationFeed(ctx, PAGE_FEED_LIMIT);

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <NotificationsClient initialFeed={feed} />
    </div>
  );
}
