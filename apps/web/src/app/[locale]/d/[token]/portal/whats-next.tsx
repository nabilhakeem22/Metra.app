'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JourneyMilestoneKey } from '@/lib/engagements/journey-map';
import type { PhaseView } from '@/lib/flow/types';

/**
 * One quiet line directly under the action, naming the step after the current
 * one in the rail's own view, so the action never reads as a dead end. Renders
 * nothing on the last step, or once the phase is complete or closed.
 */
export function WhatsNext({ view }: { view: PhaseView }) {
  const t = useTranslations('delivery');
  const tJourney = useTranslations('delivery.journey');
  const current = view.steps.findIndex((step) => step.status === 'current');
  const next = current < 0 ? undefined : view.steps[current + 1];
  if (!next) return null;

  return (
    <p className="flex items-baseline gap-1.5 text-small text-muted-foreground">
      <ArrowRight className="size-3.5 shrink-0 translate-y-0.5 rtl:rotate-180" aria-hidden />
      <span>
        {t('whatsNext.eyebrow')} · <span className="font-semibold text-foreground">{tJourney(next.key as JourneyMilestoneKey)}</span>
      </span>
    </p>
  );
}
