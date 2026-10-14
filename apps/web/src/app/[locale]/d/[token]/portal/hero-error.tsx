'use client';

import { useTranslations } from 'next-intl';
import { describePortalFailure, isSharedPortalError, type SharedPortalError } from '@/lib/share/portal-failure';
import type { HeroError, HeroFailure } from './hero-answer';

/** Where a hero's own sentence lives: the picker's `changed`, the `movedOn` and
 *  `reviewChanged` every hero shares, the approve+budget's own sentence, or the
 *  act's `wrong_state`. */
function ownKeyOf(error: Exclude<HeroError, SharedPortalError>) {
  if (error === 'changed') return { scope: 'picker', key: 'changed' } as const;
  if (error === 'designChangedBudgetSaved') return { scope: 'design', key: 'approvalNotSentBudgetSaved' } as const;
  if (error === 'movedOn') return { scope: 'actions', key: 'movedOn' } as const;
  if (error === 'reviewChanged') return { scope: 'actions', key: 'changed' } as const;
  return { scope: 'actions', key: 'error.wrong_state' } as const;
}

/**
 * The line an actionable hero shows when its act did not land. A failure every
 * link page shares (a dead link, too many taps, an unknown failure with its
 * reference, a promise that never answered) is said from `portal.errors`; the
 * hero's own outcomes from its catalogue. Every code has been narrowed already,
 * so no key is ever built from a raw server code. When the one-tap
 * approve+budget saved its budget half all the same, a second line says so.
 */
export function HeroErrorText({ failure }: { failure: HeroFailure }) {
  const tErrors = useTranslations('portal.errors');
  const tActions = useTranslations('delivery.actions');
  const tPicker = useTranslations('delivery.conceptPicker');
  const tDesign = useTranslations('delivery.hero.design');
  let message: string;
  if ('rejection' in failure) message = describePortalFailure(failure, tErrors);
  else if (isSharedPortalError(failure.error)) {
    message = describePortalFailure({ error: failure.error, reference: failure.reference }, tErrors);
  } else {
    const { scope, key } = ownKeyOf(failure.error);
    message = { picker: tPicker, actions: tActions, design: tDesign }[scope](key);
  }
  const budgetSaved = !('rejection' in failure) && failure.budget === 'acknowledged';
  return (
    <div role="alert" className="space-y-1">
      <p className="text-body text-destructive">{message}</p>
      {budgetSaved && <p className="text-body font-medium text-foreground">{tDesign('budgetAcknowledgedOnly')}</p>}
    </div>
  );
}
