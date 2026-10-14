'use client';

import { CalendarClock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { setClientExpectedDate } from '@/lib/engagements/actions';
import {
  CLIENT_EXPECTED_FIELDS,
  clientExpectedFieldErrors,
} from '@/lib/engagements/client-expected-field-rules';
import { formatDate } from '@/lib/format/date';
import type { ClientExpectedCard } from './client-expected-card';
import { FormRefusal } from './form-refusal';
import type { RunAction } from './use-engagement-action';

const DATE_ID = 'client-expected-on';

/**
 * "When should the client expect the next step?" (Round C, C8): one date the
 * client page shows under its hero. The card says what the client sees now,
 * and, once the date has passed or the delivery has moved on, that it needs a
 * new one. Saves and clears through the card's `runAction`; a refused date is
 * said under the date box, and a success refreshes the page.
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
  const te = useTranslations('errors');
  const locale = useLocale();
  const { view } = card;
  const [value, setValue] = useState(view.kind === 'showing' ? view.on : '');
  const errors = useFieldErrors({ fields: CLIENT_EXPECTED_FIELDS, translate: te });
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(cardRef, errors.invalidAttempt);
  const refusal = errors.messageFor('expectedOn');

  const send = (expectedOn: string | null) =>
    runAction(() => setClientExpectedDate({ engagementId, expectedOn }), undefined, undefined, errors);
  function save() {
    if (errors.applyLocal(clientExpectedFieldErrors(value, new Date()))) return;
    send(value);
  }
  function clearDate() {
    setValue('');
    errors.clear();
    send(null);
  }

  return (
    <div
      ref={cardRef}
      className="mt-4 space-y-2 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      <Label htmlFor={DATE_ID} className="flex items-center gap-2">
        <CalendarClock className="size-4 text-[color:var(--text-muted)]" aria-hidden />
        {t('label')}
      </Label>
      {view.kind === 'showing' && (
        <p className="text-small font-medium">{t('showing', { date: formatDate(view.on, locale) })}</p>
      )}
      {(view.kind === 'passed' || view.kind === 'moved') && (
        <p className="text-small font-medium text-[color:var(--warn)]" role="status">
          {t(view.kind === 'passed' ? 'stale' : 'moved')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={DATE_ID}
          type="date"
          dir="ltr"
          className="w-auto"
          min={card.min}
          max={card.max}
          value={value}
          aria-invalid={refusal ? true : undefined}
          aria-describedby={refusal ? fieldErrorId(DATE_ID) : undefined}
          onChange={(event) => {
            errors.bind('expectedOn').onEdit();
            setValue(event.target.value);
          }}
        />
        <Button variant="default" className="min-h-11" disabled={pending} onClick={save}>
          {t('save')}
        </Button>
        {view.kind !== 'none' && (
          <Button variant="secondary" className="min-h-11" disabled={pending} onClick={clearDate}>
            {t('clear')}
          </Button>
        )}
      </div>
      <FieldErrorText id={fieldErrorId(DATE_ID)} message={refusal} />
      <FormRefusal message={errors.formError} />
      <p className="text-small text-[color:var(--text-muted)]">{t('hint')}</p>
    </div>
  );
}
