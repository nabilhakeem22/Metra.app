'use client';

import { CalendarClock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setClientExpectedDate } from '@/lib/engagements/actions';
import { formatDate } from '@/lib/format/date';
import type { ClientExpectedCard } from './client-expected-card';
import type { RunAction } from './use-engagement-action';

/**
 * "When should the client expect the next step?" (Round C, C8): one date the
 * client page shows under its hero. The card says what the client sees now,
 * and, once the date has passed or the delivery has moved on, that it needs a
 * new one. Saves and clears through the card's `runAction`, so a refusal shows
 * in the card and a success refreshes the page.
 */
export function ClientExpectedDate({
  engagementId,
  card,
  pending,
  runAction,
}: {
  engagementId: string;
  card: ClientExpectedCard;
  pending: boolean;
  runAction: RunAction;
}) {
  const t = useTranslations('engagements.clientExpected');
  const locale = useLocale();
  const { view } = card;
  const [value, setValue] = useState(view.kind === 'showing' ? view.on : '');

  const save = (expectedOn: string | null) => {
    if (expectedOn === null) setValue('');
    runAction(() => setClientExpectedDate({ engagementId, expectedOn }));
  };

  return (
    <div className="mt-4 space-y-2 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <Label htmlFor="client-expected-on" className="flex items-center gap-2">
        <CalendarClock className="size-4 text-[color:var(--text-muted)]" aria-hidden />
        {t('label')}
      </Label>
      {view.kind === 'showing' && (
        <p className="text-small font-medium">{t('showing', { date: formatDate(view.on, locale) })}</p>
      )}
      {view.kind === 'stale' && (
        <p className="text-small font-medium text-[color:var(--warn)]" role="status">
          {t('stale')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="client-expected-on"
          type="date"
          dir="ltr"
          className="w-auto"
          min={card.min}
          max={card.max}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button variant="default" className="min-h-11" disabled={pending || value === ''} onClick={() => save(value)}>
          {t('save')}
        </Button>
        {view.kind !== 'none' && (
          <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => save(null)}>
            {t('clear')}
          </Button>
        )}
      </div>
      <p className="text-small text-[color:var(--text-muted)]">{t('hint')}</p>
    </div>
  );
}
