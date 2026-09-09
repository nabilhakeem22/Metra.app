'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  JOURNEY_MILESTONES,
  type MilestoneProgress,
} from '@/lib/engagements/journey-map';

/**
 * The "up next" strip — names the milestone that follows the client's current
 * position, so the process feels like it carries them forward. Renders nothing
 * once the journey is complete, closed, or already on the final milestone.
 */
export function WhatsNext({
  milestone,
  bare = false,
}: {
  milestone: MilestoneProgress;
  /** One quiet line under the action, rather than its own card. */
  bare?: boolean;
}) {
  const t = useTranslations('delivery');
  const tJourney = useTranslations('delivery.journey');

  if (milestone.closed || milestone.allComplete) return null;
  const nextIndex = milestone.index + 1;
  const nextMilestone = JOURNEY_MILESTONES[nextIndex];
  if (!nextMilestone) return null;

  if (bare) {
    // Directly under the button: the mockup's rule is that the action never
    // reads as a dead end, and a "what happens next" card five sections down the
    // page does not do that job.
    return (
      <p className="flex items-baseline gap-1.5 text-[12.5px] text-muted-foreground">
        <ArrowRight className="size-3.5 shrink-0 translate-y-0.5 rtl:rotate-180" aria-hidden />
        <span>
          {t('whatsNext.eyebrow')} · <span className="font-semibold text-foreground">{tJourney(nextMilestone.key)}</span>
        </span>
      </p>
    );
  }

  return (
    <section className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-4">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"
        aria-hidden
      >
        <ArrowRight className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('whatsNext.eyebrow')}
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold">
          {tJourney(nextMilestone.key)}
        </p>
      </div>
    </section>
  );
}
