'use client';

import { BadgeCheck, Calculator, FileSignature, Hammer, PenLine, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PhaseRail, type StepNote } from '@/components/flow/phase-rail';
import { EXECUTION_PHASE, type ExecutionStepKey } from '@/lib/flow/phases/execution';
import type { PhaseView, StepView } from '@/lib/flow/types';

/** One glyph per execution step. Decoration only: each sits beside its own label and is aria-hidden. */
const STEP_ICON: Readonly<Record<ExecutionStepKey, LucideIcon>> = {
  contract: FileSignature,
  signature: PenLine,
  works: Hammer,
  final_account: Calculator,
  settled: BadgeCheck,
};

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
  return <PhaseRail view={view} labels={labels} icons={STEP_ICON} notes={notes} />;
}
