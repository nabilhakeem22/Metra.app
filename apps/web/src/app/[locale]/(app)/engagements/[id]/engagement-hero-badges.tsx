'use client';

import type { useTranslations } from 'next-intl';
import {
  revisionAllowanceFor,
  revisionTriggerAtState,
  type RevisionAllowances,
} from '@/lib/engagements/revision-allowance';
import type { DesignState } from '@/lib/engagements/states';

// The stall + revision badge row at the top of the cockpit hero. Purely
// presentational; rendered by the parent only when the engagement is not closed.
//
// The revision badge shows the allowance that is SPENDABLE at the current state —
// the 3D pair once the design is in flight (design_3d / final_approval /
// shop_drawings), the concept pair before it — resolved through the shared
// `revision-allowance` leaf, the same one the revision form prices against. Both
// pairs are independent, so reading the concept counter at a 3D state let the
// badge say "Revision 3 of 3" while the form offered a FREE 3D revision.
export function EngagementHeroBadges({
  t,
  th,
  state,
  stallDays,
  allowances,
}: {
  t: ReturnType<typeof useTranslations<'engagements'>>;
  th: ReturnType<typeof useTranslations<'engagements.hero'>>;
  state: DesignState;
  stallDays: number | null;
  allowances: RevisionAllowances;
}) {
  const revisionTrigger = revisionTriggerAtState(state);
  const { count, free } = revisionAllowanceFor(revisionTrigger, allowances);

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
          {revisionTrigger === 'designChangeRaised'
            ? th('designRevision', { n: count, free })
            : th('revision', { n: count, free })}
        </span>
      </span>
    </div>
  );
}
