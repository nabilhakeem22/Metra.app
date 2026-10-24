'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import { STAGES_WAITING_ON_CLIENT } from '@/lib/execution/next-action-target';
import type { StepLocation } from '@/lib/flow/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { pickLocale } from '@/lib/i18n/pick-locale';

/** What the execution step card SAYS. */
export interface ExecutionStepCopy {
  /** Who acts, and the contract it is on. */
  eyebrow: string;
  /** The next action in words, or the stage once nothing is left to do. */
  headline: string;
  hint: string | null;
  /** The next action's words, for its own control; null when there is none. */
  actionLabel: string | null;
  /** Said when the client holds the move and has no email on file; null otherwise. */
  noEmailNotice: string | null;
}

/**
 * The headline is the next action itself (`execution.card.next.*`), the hint
 * where the contract stands. While the job waits on the client the eyebrow says
 * so, as it does on the design card; once settled or terminated the stage is
 * the headline and there is no action to name.
 */
export function useExecutionStepCopy(options: {
  view: ExecutionCardView;
  location: StepLocation;
  clientHasEmail: boolean;
}): ExecutionStepCopy {
  const t = useTranslations('execution.card');
  const tcmd = useTranslations('engagements.command');
  const tflow = useTranslations('engagements.flow');
  const locale = useLocale();
  const { view, location, clientHasEmail } = options;

  const instalment = view.nextInstalment && pickLocale(view.nextInstalment, 'label', locale).value;
  const actionLabel = view.next && t(`next.${view.next.kind}`, { instalment: instalment || t('anInstalment') });
  const actor = location.whoseMove === null ? t('title') : tcmd(location.whoseMove === 'client' ? 'pill.waitingClient' : 'nextAction');
  const stage = t(`stage.${view.stage}`);
  return {
    // `·` not a dash: the eyebrow renders in ar-EG (scripts/i18n/style-guide.md rule 6).
    eyebrow: view.contract ? `${actor} · ${bidiIsolate(view.contract.documentNumber)}` : actor,
    headline: actionLabel ?? stage,
    hint: actionLabel === null ? null : STAGES_WAITING_ON_CLIENT.has(view.stage) ? t('waitingOnClient') : stage,
    actionLabel,
    noEmailNotice:
      view.next && location.whoseMove === 'client' && !clientHasEmail ? tflow(`noEmail.${view.next.kind}`) : null,
  };
}
