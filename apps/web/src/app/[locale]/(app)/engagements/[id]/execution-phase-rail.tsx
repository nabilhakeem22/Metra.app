'use client';

import { useTranslations } from 'next-intl';
import { EXECUTION_STEP_ICON } from '@/components/flow/execution-step-icons';
import { PhaseRail, type StepNote } from '@/components/flow/phase-rail';
import { EXECUTION_PHASE } from '@/lib/flow/phases/execution';
import type { PhaseView, StepView } from '@/lib/flow/types';

// The cockpit's EXECUTION RAIL: the five execution steps on the shared phase
// rail, each with whose move it is under its name, in the studio's words. A
// terminated contract mutes the rail and says nobody's move: none of it is
// reached any more.
export function ExecutionPhaseRail({ view }: { view: PhaseView }) {
  const t = useTranslations('engagements.flow');
  const labels = Object.fromEntries(EXECUTION_PHASE.steps.map((step) => [step.key, t(`execution.${step.key}`)]));
  const who = (step: StepView): string => {
    if (step.status === 'done') return t('who.done');
    return t(`who.${step.status === 'current' ? 'now' : 'later'}.${step.actor}`);
  };
  const notes: Record<string, StepNote> | undefined =
    view.status === 'closed' ? undefined : Object.fromEntries(view.steps.map((step) => [step.key, { who: who(step) }]));
  return <PhaseRail view={view} labels={labels} icons={EXECUTION_STEP_ICON} notes={notes} />;
}
