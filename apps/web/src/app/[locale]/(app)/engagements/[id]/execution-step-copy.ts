'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import { STAGES_WAITING_ON_CLIENT } from '@/lib/execution/next-action-target';
import type { StudioExecutionLocation } from '@/lib/flow/locate/execution-studio';
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
}

/**
 * The headline is the next action itself (`execution.card.next.*`), the hint
 * where the contract stands. While the job waits on the client the eyebrow says
 * so, as it does on the design card; once settled or terminated the stage is
 * the headline and there is no action to name. A client wait the studio has
 * taken back (lib/flow/locate/execution-studio.ts) says the studio's act
 * instead (`execution.card.studioTakesBack.*`), keyed by why it was taken back.
 */
export function useExecutionStepCopy(options: { view: ExecutionCardView; location: StudioExecutionLocation }): ExecutionStepCopy {
  const t = useTranslations('execution.card');
  const tcmd = useTranslations('engagements.command');
  const locale = useLocale();
  const { view, location } = options;
  const actor = location.whoseMove === null ? t('title') : tcmd(location.whoseMove === 'client' ? 'pill.waitingClient' : 'nextAction');
  // `·` not a dash: the eyebrow renders in ar-EG (scripts/i18n/style-guide.md rule 6).
  const eyebrow = view.contract ? `${actor} · ${bidiIsolate(view.contract.documentNumber)}` : actor;
  const stage = t(`stage.${view.stage}`);
  if (!view.next) return { eyebrow, headline: stage, hint: null, actionLabel: null };

  if (location.takenBack) {
    const actionLabel = t(`studioTakesBack.${location.takenBack}.headline`);
    return { eyebrow, headline: actionLabel, hint: t(`studioTakesBack.${location.takenBack}.hint`), actionLabel };
  }
  const instalment = view.nextInstalment && pickLocale(view.nextInstalment, 'label', locale).value;
  const actionLabel = t(`next.${view.next.kind}`, { instalment: instalment || t('anInstalment') });
  const waiting = location.whoseMove === 'client' && STAGES_WAITING_ON_CLIENT.has(view.stage);
  return { eyebrow, headline: actionLabel, hint: waiting ? t('waitingOnClient') : stage, actionLabel };
}
