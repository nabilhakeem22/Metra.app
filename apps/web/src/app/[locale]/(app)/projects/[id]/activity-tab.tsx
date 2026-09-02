'use client';

import { History, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { addActivity } from '@/lib/activities/actions';
import type { LogEntry } from '@/lib/logs/entries';
import { formatDate } from '@/lib/format/date';

export function ActivityTab({
  projectId,
  entries,
  canActivity,
}: {
  projectId: string;
  /** The MERGED feed: activity (what people said) + audit (who changed what).
   *  Neither alone is the log a firm means when they ask for one. */
  entries: LogEntry[];
  canActivity: boolean;
}) {
  const t = useTranslations('projects.profile.activity');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!note.trim()) return;
    startTransition(async () => {
      const res = await addActivity({
        entityType: 'project',
        entityId: projectId,
        note,
      });
      if (res.ok) {
        setNote('');
        router.refresh();
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      {canActivity && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={3}
              className="w-full glass-field outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] p-2 text-sm"
              aria-label={t('add')}
            />
            <div className="flex justify-end">
              <Button type="button" onClick={submit} disabled={pending || !note.trim()}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('add')}
              </Button>
            </div>
          </CardContent>
        </Card>
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
                    <span className="flex items-center gap-2 text-sm font-medium">
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
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {formatDate(e.at, locale)}
                    </span>
                  </div>
                  {e.note && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
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
