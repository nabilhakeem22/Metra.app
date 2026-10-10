'use client';

import { useTranslations } from 'next-intl';
import type { HeroError } from './hero-answer';

/** The message of one hero error: the picker's `changed`, the one `movedOn`
 *  every hero shares, or a narrowed portal error key. */
function messageKeyOf(error: HeroError): { scope: 'picker' | 'actions'; key: string } {
  if (error === 'changed') return { scope: 'picker', key: 'changed' };
  if (error === 'movedOn') return { scope: 'actions', key: 'movedOn' };
  return { scope: 'actions', key: `error.${error}` };
}

/**
 * The line an actionable hero shows when its act did not land. Every code has
 * been narrowed already (`portalErrorKey`, the picker's `changed`, or the
 * shared `movedOn`), so no key is ever built from a raw server code.
 */
export function HeroErrorText({ error }: { error: HeroError }) {
  const tActions = useTranslations('delivery.actions');
  const tPicker = useTranslations('delivery.conceptPicker');
  const { scope, key } = messageKeyOf(error);
  return (
    <p className="text-body text-destructive" role="alert">
      {scope === 'picker' ? tPicker(key) : tActions(key)}
    </p>
  );
}
