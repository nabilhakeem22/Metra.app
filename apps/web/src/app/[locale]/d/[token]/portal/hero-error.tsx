'use client';

import { useTranslations } from 'next-intl';
import type { HeroError } from './hero-answer';

/** The message of one hero error: the picker's `changed`, the `movedOn` and
 *  `reviewChanged` every hero shares, the approve+budget's own sentence, or a
 *  narrowed portal error key. */
function messageKeyOf(error: HeroError): { scope: 'picker' | 'actions' | 'design'; key: string } {
  if (error === 'changed') return { scope: 'picker', key: 'changed' };
  if (error === 'designChangedBudgetSaved') return { scope: 'design', key: 'approvalNotSentBudgetSaved' };
  if (error === 'movedOn') return { scope: 'actions', key: 'movedOn' };
  if (error === 'reviewChanged') return { scope: 'actions', key: 'changed' };
  return { scope: 'actions', key: `error.${error}` };
}

/**
 * The line an actionable hero shows when its act did not land. Every code has
 * been narrowed already (`portalErrorKey`, the picker's `changed`, or the
 * shared `movedOn`), so no key is ever built from a raw server code. When the
 * one-tap approve+budget saved its budget half all the same, a second line
 * says so (`budget`).
 */
export function HeroErrorText({ error, budget }: { error: HeroError; budget?: 'acknowledged' }) {
  const tActions = useTranslations('delivery.actions');
  const tPicker = useTranslations('delivery.conceptPicker');
  const tDesign = useTranslations('delivery.hero.design');
  const { scope, key } = messageKeyOf(error);
  const message = { picker: tPicker, actions: tActions, design: tDesign }[scope](key);
  return (
    <div role="alert" className="space-y-1">
      <p className="text-body text-destructive">{message}</p>
      {budget === 'acknowledged' && <p className="text-body font-medium text-foreground">{tDesign('budgetAcknowledgedOnly')}</p>}
    </div>
  );
}
