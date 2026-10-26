'use client';

import { useTranslations } from 'next-intl';
import { ActivityFeed } from '@/components/activity/activity-feed';
import type { LogEntry } from '@/lib/logs/entries';

export function ActivityTab({
  clientId,
  entries,
  canActivity,
}: {
  clientId: string;
  entries: LogEntry[];
  canActivity: boolean;
}) {
  const t = useTranslations('clients.profile.activity');
  return <ActivityFeed entityType="client" entityId={clientId} entries={entries} canActivity={canActivity} t={t} />;
}
