'use client';

import { useTranslations } from 'next-intl';
import type { DesignEngagementState } from '@metra/db';
import { StatusChip } from '@/components/ui/status-chip';
import { spinePosition, spineStageKeyOf } from '@/lib/engagements/stage-spine';
import type { DesignState } from '@/lib/engagements/states';
import { DESIGN_STATE_TONE } from '@/lib/ui/record-status-tones';

// The machine state as a chip, on the shared StatusChip tones: a new delivery is
// a draft, both endings are done, everything in flight (and abandoned) is
// neutral. Whose move it is, and for how long, is the delivery status chip's job.

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
      <StatusChip tone={DESIGN_STATE_TONE[state as DesignState]} label={t(`state.${state}`)} />
      {showStage && !position.closed && (
        <span className="text-caption text-[color:var(--text-muted)]">
          {spine(spineStageKeyOf(state as DesignState))}
          {position.atGate ? ` · ${spine(position.atGate)}` : ''}
        </span>
      )}
    </span>
  );
}
