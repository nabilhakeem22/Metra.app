'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  JOURNEY_MILESTONES,
  type MilestoneProgress,
} from '@/lib/engagements/journey-map';

type StepState = 'done' | 'now' | 'future';

/**
 * Resolve each of the five steps to done / now / future per the render rule:
 *  - allComplete → every step done
 *  - closed (abandoned) → every step muted (future)
 *  - otherwise → i < index done, i === index now, i > index future
 */
function stepStates(milestone: MilestoneProgress): StepState[] {
  return JOURNEY_MILESTONES.map((_, index): StepState => {
    if (milestone.closed) return 'future';
    if (milestone.allComplete) return 'done';
    if (index < milestone.index) return 'done';
    if (index === milestone.index) return 'now';
    return 'future';
  });
}

/**
 * The five-milestone journey tracker (Proposal → Handover). Logical CSS only, so
 * the connector line mirrors correctly in RTL (inset-inline-start). Never shows a
 * raw machine state — it renders only the derived MilestoneProgress.
 */
export function JourneyTracker({ milestone }: { milestone: MilestoneProgress }) {
  const t = useTranslations('delivery.journey');
  const states = stepStates(milestone);

  return (
    <section className="rounded-2xl border bg-muted/40 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('eyebrow')}
      </p>
      <ol className="flex items-start">
        {JOURNEY_MILESTONES.map((step, index) => {
          const state = states[index];
          const active = state === 'done' || state === 'now';
          return (
            <li
              key={step.key}
              className="relative flex flex-1 flex-col items-center gap-2 text-center"
            >
              {index > 0 && (
                <span
                  aria-hidden
                  className={`absolute top-3 -start-1/2 h-0.5 w-full ${
                    active ? 'bg-primary' : 'bg-border'
                  }`}
                />
              )}
              <span
                className={`relative z-10 flex size-6 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                  state === 'done'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : state === 'now'
                      ? 'border-primary bg-background text-primary ring-4 ring-primary/15'
                      : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {state === 'done' ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={`text-[10px] font-semibold leading-tight ${
                  active ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {t(step.key)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
