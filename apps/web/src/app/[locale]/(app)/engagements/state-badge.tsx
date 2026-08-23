'use client';

import { useTranslations } from 'next-intl';
import type { DesignEngagementState } from '@metra/db';
import { STAGE_NUMBER, type DesignState } from '@/lib/engagements/states';

// Colour families mirror the contracts status badge: neutral for in-flight, blue
// for the active design push, emerald for a good terminal outcome, destructive for
// abandoned. Any state without an explicit entry falls back to blue.
const STATE_STYLE: Partial<Record<DesignEngagementState, string>> = {
  created: 'bg-muted text-muted-foreground',
  closed_design_only: 'bg-emerald-500/10 text-emerald-600',
  execution: 'bg-emerald-500/10 text-emerald-600',
  abandoned: 'bg-destructive/10 text-destructive',
  change_triage: 'bg-amber-500/10 text-amber-600',
};

export function StateBadge({
  state,
  showStage = false,
}: {
  state: DesignEngagementState;
  showStage?: boolean;
}) {
  const t = useTranslations('engagements');
  const stage = STAGE_NUMBER[state as DesignState];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          STATE_STYLE[state] ?? 'bg-blue-500/10 text-blue-600'
        }`}
      >
        {t(`state.${state}`)}
      </span>
      {showStage && stage > 0 && (
        <span className="text-xs text-muted-foreground" dir="ltr">
          {t('stage', { n: stage })}
        </span>
      )}
    </span>
  );
}
