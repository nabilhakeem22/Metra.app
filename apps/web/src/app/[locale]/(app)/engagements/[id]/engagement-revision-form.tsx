'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { designChangeRaised, requestRevision } from '@/lib/engagements/actions';
import {
  revisionAmountRequired,
  type RevisionAllowances,
  type RevisionTrigger,
} from '@/lib/engagements/revision-allowance';
import { REVISION_FIELDS, revisionFieldErrors } from '@/lib/engagements/revision-field-rules';
import { FormActions } from './engagement-form-actions';
import { FormRefusal } from './form-refusal';
import type { RunAction } from './run-action';

// The revision payload form (an optional reason + the change-order amount that
// becomes required once a revision crosses the free allowance). Extracted from the
// retired `engagement-next-actions.tsx` so the command card's low-emphasis
// secondary controls can open it unchanged. It drives BOTH revision edges —
// `requestRevision` revises the concept in negotiation, `designChangeRaised` pulls
// the engagement back to design_3d so the studio can revise and RE-ISSUE the 3D —
// and the `trigger` prop also selects WHICH of the two independent allowances the
// revision is priced against. Flat tray (opaque `--track` fill, no `.glass`) so it
// never nests a backdrop-filter inside the glass command card.
export function EngagementRevisionForm({
  engagementId,
  trigger,
  allowances,
  pending,
  runAction,
  onCancel,
}: {
  engagementId: string;
  /** Which revision edge to fire — it picks the copy AND the allowance pair. */
  trigger: RevisionTrigger;
  // BOTH counter/allowance pairs. Whether a change-order amount is even solicited
  // depends on the pair THIS trigger spends: a revision still within that edge's
  // free allowance never raises a charge, so the amount field is hidden AND
  // submitted as undefined. The concept and 3D allowances never draw on each other.
  allowances: RevisionAllowances;
  pending: boolean;
  /** Runs one server action with the per-attempt idempotency key held for THIS
   *  trigger (0050). Ignore the argument on an edge that does not need one. */
  runAction: RunAction;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.revisionForm');
  const tc = useTranslations('engagements.controls');
  const te = useTranslations('errors');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const errors = useFieldErrors({ fields: REVISION_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  // This next revision crosses ITS OWN free allowance → it will raise a change
  // order, which requires a positive amount. Within the allowance the field is
  // omitted. The server re-decides; this only chooses what to solicit.
  const amountRequired = revisionAmountRequired(trigger, allowances);
  const isDesignChange = trigger === 'designChangeRaised';

  function submit() {
    if (errors.applyLocal(revisionFieldErrors({ changeOrderAmount: amount }, amountRequired))) return;
    const payload = {
      reason: reason.trim() || undefined,
      changeOrderAmount: amountRequired ? amount.trim() || undefined : undefined,
    };
    runAction(
      (idempotencyKey) =>
        isDesignChange
          ? designChangeRaised(engagementId, payload)
          : requestRevision(engagementId, payload, idempotencyKey),
      trigger,
      undefined,
      errors,
    );
  }

  return (
    <div
      ref={formRef}
      className="space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      <p className="text-body font-medium">
        {isDesignChange ? t('designChangeTitle') : t('title')}
      </p>
      <FormField id="rev-reason" label={t('reason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      {amountRequired && (
        <div className="space-y-1.5">
          <FormField id="rev-amount" label={t('addAmount')} required {...errors.bind('changeOrderAmount')}>
            <Input
              dir="ltr"
              inputMode="decimal"
              className="tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          <p className="text-caption text-muted-foreground">{t('hint')}</p>
        </div>
      )}
      <FormRefusal message={errors.formError} />
      <FormActions
        pending={pending}
        onCancel={onCancel}
        onSave={submit}
        saveLabel={isDesignChange ? t('designChangeSubmit') : t('submit')}
        cancelLabel={tc('cancel')}
      />
    </div>
  );
}
