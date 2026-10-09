'use client';

import { useTranslations } from 'next-intl';
import type { HeroError } from './hero-answer';

/**
 * The line an actionable hero shows when its act did not land. Every code has
 * been narrowed already (`portalErrorKey`, or the picker's `changed` /
 * `movedOn`), so no key is ever built from a raw server code.
 */
export function HeroErrorText({ error }: { error: HeroError }) {
  const tActions = useTranslations('delivery.actions');
  const tPicker = useTranslations('delivery.conceptPicker');
  return (
    <p className="text-body text-destructive" role="alert">
      {error === 'changed' || error === 'movedOn' ? tPicker(error) : tActions(`error.${error}`)}
    </p>
  );
}
