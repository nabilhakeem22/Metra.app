'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  JOURNEY_MILESTONES,
  type MilestoneProgress,
} from '@/lib/engagements/journey-map';

type StepState = 'done' | 'now' | 'future';

/**
 * Resolve each of the six steps to done / now / future per the render rule:
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
 * The six-milestone journey tracker (Proposal → Handover): six numbered dots, a
 * tick on each one done, and the CURRENT milestone named once, beside the
 * eyebrow. Every dot carries its name for a screen reader.
 *
 * Why the names are not printed under all six dots: at 390 px each column is
 * about 54 px, so «الرسومات» broke mid-word and "Drawings and quantities" took
 * three lines, pushing the hero's headline down by about 45 px.
 *
 * Logical CSS only, so the connector line mirrors correctly in RTL
 * (inset-inline-start). Never shows a raw machine state — it renders only the
 * derived MilestoneProgress.
 */
export function JourneyTracker({
  milestone,
  bare = false,
}: {
  milestone: MilestoneProgress;
  /** Render without card chrome, for use INSIDE the command card. */
  bare?: boolean;
}) {
  const t = useTranslations('delivery.journey');
  const states = stepStates(milestone);
  const current = JOURNEY_MILESTONES[states.indexOf('now')];

  return (
    <section className={bare ? '' : 'rounded-panel border bg-muted/40 p-4'}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-caption font-semibold text-muted-foreground ltr:uppercase ltr:tracking-wider">
          {t('eyebrow')}
        </p>
        {current && (
          <p aria-hidden className="truncate text-caption font-semibold text-foreground">
            {t(current)}
          </p>
        )}
      </div>
      <ol className="flex items-start">
        {JOURNEY_MILESTONES.map((step, index) => {
          const state = states[index];
          const active = state === 'done' || state === 'now';
          return (
            <li
              key={step}
              aria-current={state === 'now' ? 'step' : undefined}
              className="relative flex min-w-0 flex-1 justify-center"
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
                className={`relative z-10 flex size-6 items-center justify-center rounded-full border-2 text-caption font-bold ${
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
              <span className="sr-only">{t(step)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
