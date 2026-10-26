'use client';

import { useTranslations } from 'next-intl';
import { ActivityFeed } from '@/components/activity/activity-feed';
import type { LogEntry } from '@/lib/logs/entries';

export function ActivityTab({
  projectId,
  entries,
  canActivity,
}: {
  projectId: string;
  entries: LogEntry[];
  canActivity: boolean;
}) {
  const t = useTranslations('projects.profile.activity');
  return <ActivityFeed entityType="project" entityId={projectId} entries={entries} canActivity={canActivity} t={t} />;
}
