'use client';

import { useTranslations } from 'next-intl';
import type { DesignEngagementState } from '@metra/db';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { spinePosition, spineStageKeyOf } from '@/lib/engagements/stage-spine';
import type { DesignState } from '@/lib/engagements/states';

// Status families map to the glass semantic tokens via the Badge variants (NOT
// raw emerald/amber/blue utilities): neutral for in-flight, brand for the active
// design push, success for a good terminal outcome, danger for abandoned, warn
// for the change-triage detour. Any state without an explicit entry falls back
// to the brand ("active") variant. Mirrors the contracts status badge.
const STATE_VARIANT: Partial<Record<DesignEngagementState, BadgeProps['variant']>> =
  {
    created: 'default',
    closed_design_only: 'success',
    execution: 'success',
    abandoned: 'danger',
    change_triage: 'warn',
  };

export function StateBadge({
  state,
  showStage = false,
}: {
  state: DesignEngagementState;
  showStage?: boolean;
}) {
  const t = useTranslations('engagements');
  const spine = useTranslations('engagements.spine');
  // The stage IN WORDS, from the same spine the delivery page draws, never a
  // number: the machine has 16 states and the ribbon 8 stages, so "Stage 14"
  // disagreed with every picture of progress in the app.
  const position = spinePosition(state as DesignState);
  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={STATE_VARIANT[state] ?? 'brand'}>{t(`state.${state}`)}</Badge>
      {showStage && !position.closed && (
        <span className="text-caption text-[color:var(--text-muted)]">
          {spine(spineStageKeyOf(state as DesignState))}
          {position.atGate ? ` · ${spine(position.atGate)}` : ''}
        </span>
      )}
    </span>
  );
}
