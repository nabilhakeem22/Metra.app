'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { todayInCairo } from '@/lib/automation/clock';
import { recordContractSignedOffline } from '@/lib/contracts/actions';
import {
  SIGN_OFFLINE_FIELDS,
  offlineSignatureFieldErrors,
  type SignOfflineField,
} from '@/lib/contracts/sign-offline-input';

/** The DOM id of a box of the dialog: its refusal sits under it. */
export const signOfflineControlId = (field: SignOfflineField) => `sign-offline-${field}`;

/**
 * "The client signed on paper" (owner decision D5): the studio records the day
 * an issued execution contract was signed outside Metra, and a note. Offered to
 * owner, admin and project manager only; the server checks again. The day may
 * not be after today in Cairo; each refusal is said under its box, one of the
 * contract itself (signed on /c meanwhile) above the footer.
 */
export function SignOfflineDialog({ contractId }: { contractId: string }) {
  const t = useTranslations('contracts.execution.signOffline');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = todayInCairo(new Date());
  const [signedOn, setSignedOn] = useState(today);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: SIGN_OFFLINE_FIELDS, translate: te });

  function submit() {
    if (errors.applyLocal(offlineSignatureFieldErrors({ signedOn, note }, today))) return;
    startTransition(async () => {
      try {
        const res = await recordContractSignedOffline({ contractId, signedOn, note });
        if (errors.applyResult(res)) return;
        setOpen(false);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('description')}
        onSubmit={submit}
        submitLabel={t('submit')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        pending={pending}
        formError={errors.formError}
        invalidAttempt={errors.invalidAttempt}
      >
        <FormField id={signOfflineControlId('signedOn')} label={t('signedOn')} required {...errors.bind('signedOn')}>
          <Input type="date" dir="ltr" max={today} value={signedOn} onChange={(event) => setSignedOn(event.target.value)} />
        </FormField>
        <FormField id={signOfflineControlId('note')} label={t('note')} {...errors.bind('note')}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
      </FormSheet>
    </>
  );
}
