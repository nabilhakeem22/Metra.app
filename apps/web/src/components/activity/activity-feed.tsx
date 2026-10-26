'use client';

import { History } from 'lucide-react';
import { useLocale } from 'next-intl';
import { ActivityNoteForm } from '@/components/activity/activity-note-form';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { LogEntry } from '@/lib/logs/entries';
import { formatDate } from '@/lib/format/date';

/**
 * A client's or a project's Activity tab: the note form (for a role that may
 * write one) above the log. `t` is the tab's own namespace (`notePlaceholder`,
 * `add`, `empty`, `kinds.*`), bound by the caller so each tab keeps naming its
 * namespace literally.
 */
export function ActivityFeed({
  entityType,
  entityId,
  entries,
  canActivity,
  t,
}: {
  entityType: 'client' | 'project';
  entityId: string;
  /** The MERGED feed: activity (what people said) + audit (who changed what).
   *  Neither alone is the log a firm means when they ask for one. */
  entries: LogEntry[];
  canActivity: boolean;
  t: (key: string) => string;
}) {
  const locale = useLocale();

  return (
    <div className="space-y-4">
      {canActivity && (
        <ActivityNoteForm entityType={entityType} entityId={entityId} placeholder={t('notePlaceholder')} addLabel={t('add')} />
      )}

      <Card>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('empty')} />
            </div>
          ) : (
            <ul className="divide-y">
              {entries.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-body font-medium">
                      {/* A quiet marker, not a colour: an audit row is a record of
                          a change, an activity row is something someone said. */}
                      {e.source === 'audit' && (
                        <History
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      {t(`kinds.${e.labelKey}`)}
                    </span>
                    <span className="text-caption text-muted-foreground" dir="ltr">
                      {formatDate(e.at, locale)}
                    </span>
                  </div>
                  {e.note && (
                    <p className="mt-1 whitespace-pre-wrap text-body text-muted-foreground">
                      {e.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
