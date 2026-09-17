'use client';

import { useTranslations } from 'next-intl';
import type { ActionResult } from '@/lib/actions/result';
import type {
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { Empty } from './engagement-panels-parts';
import { buildTimelineEntries } from './timeline-entries';
import { TimelineEntryRow } from './timeline-entry-row';

export function TimelineFeed({
  engagementId,
  transitions,
  events,
  clientActivity = [],
  canRetract,
  pending,
  runAction,
}: {
  engagementId: string;
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity?: EngagementClientActivityRecord[];
  canRetract: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const entries = buildTimelineEntries(
    { transitions, events, clientActivity },
    {
      transition: (fromState, toState) =>
        fromState && toState
          ? t('timeline.arrow', {
              from: t(`state.${fromState}`),
              to: t(`state.${toState}`),
            })
          : t(`state.${toState ?? 'created'}`),
      eventKind: (kind) => t(`eventKind.${kind}`),
      clientActivity: (kind, actorName) =>
        actorName
          ? `${t(`eventKind.${kind}`)} · ${t('clientActivity.by', { name: actorName })}`
          : t(`eventKind.${kind}`),
    },
  );

  if (entries.length === 0) return <Empty text={t('timeline.empty')} />;
  return (
    <ul className="m-0 list-none p-0">
      {entries.map((entry, index) => (
        <TimelineEntryRow
          key={entry.id}
          entry={entry}
          isLast={index === entries.length - 1}
          engagementId={engagementId}
          canRetract={canRetract}
          pending={pending}
          runAction={runAction}
        />
      ))}
    </ul>
  );
}
