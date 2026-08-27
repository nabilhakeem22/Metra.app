'use client';

import type { useTranslations } from 'next-intl';
import type { DesignState } from '@/lib/engagements/states';

// The stall + revision badge row at the top of the cockpit hero. Purely
// presentational; rendered by the parent only when the engagement is not closed.
export function EngagementHeroBadges({
  t,
  th,
  state,
  stallDays,
  revisionCount,
  freeRevisionN,
}: {
  t: ReturnType<typeof useTranslations<'engagements'>>;
  th: ReturnType<typeof useTranslations<'engagements.hero'>>;
  state: DesignState;
  stallDays: number | null;
  revisionCount: number;
  freeRevisionN: number;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap gap-2">
      {stallDays !== null && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--warn-tint)] px-2.5 py-1 text-xs font-semibold text-[color:var(--warn)]">
          <span aria-hidden>⏱</span>
          {t(`state.${state}`)}
          <span className="font-mono font-medium tabular-nums" dir="ltr">
            · {th('day', { n: stallDays })}
          </span>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--track)] px-2.5 py-1 text-xs font-semibold text-[color:var(--text-muted)]">
        <span className="font-mono font-medium tabular-nums" dir="ltr">
          {th('revision', { n: revisionCount, free: freeRevisionN })}
        </span>
      </span>
    </div>
  );
}
