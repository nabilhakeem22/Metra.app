import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { listNotifications } from '@/lib/notifications/queries';
import { NotificationsClient, type FeedItem } from './notifications-client';

export default async function NotificationsPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('notifications');

  const rows = await listNotifications(ctx, { limit: 50 });
  const items: FeedItem[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    bodyKey: n.bodyKey,
    params: (n.params ?? {}) as Record<string, unknown>,
    entityType: n.entityType,
    entityId: n.entityId,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt != null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <NotificationsClient items={items} />
    </div>
  );
}
