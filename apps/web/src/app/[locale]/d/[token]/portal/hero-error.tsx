'use client';

import { useTranslations } from 'next-intl';
import type { BudgetPart } from '@/lib/engagements/review-outcome';
import type { HeroError } from './hero-answer';

/** The message of one hero error: the picker's `changed`, the `movedOn` and
 *  `reviewChanged` every hero shares, or a narrowed portal error key. */
function messageKeyOf(error: HeroError): { scope: 'picker' | 'actions'; key: string } {
  if (error === 'changed') return { scope: 'picker', key: 'changed' };
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
export function HeroErrorText({ error, budget }: { error: HeroError; budget?: BudgetPart }) {
  const tActions = useTranslations('delivery.actions');
  const tPicker = useTranslations('delivery.conceptPicker');
  const tDesign = useTranslations('delivery.hero.design');
  const { scope, key } = messageKeyOf(error);
  return (
    <div role="alert" className="space-y-1">
      <p className="text-body text-destructive">{scope === 'picker' ? tPicker(key) : tActions(key)}</p>
      {budget === 'acknowledged' && <p className="text-body font-medium text-foreground">{tDesign('budgetAcknowledgedOnly')}</p>}
    </div>
  );
}
