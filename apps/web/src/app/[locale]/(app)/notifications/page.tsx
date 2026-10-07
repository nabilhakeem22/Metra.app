import { getTranslations } from 'next-intl/server';
import { PAGE_FEED_LIMIT } from '@/components/notifications/feed-item';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { loadNotificationFeed } from '@/lib/notifications/feed';
import { NotificationsClient } from './notifications-client';

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
