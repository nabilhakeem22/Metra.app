'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { PayCtaMode } from '@/lib/engagements/command-card-ctas';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
// Leaf import (guards/trigger-money-gate), not the barrel — the barrel also pulls
// GUARDS from ./registry into this client chunk (heavy, cycle-prone, can init a
// binding as undefined at render). The leaf is the pure MONEY_GUARD_MILESTONE map
// and the trigger lookup beside it.
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards/trigger-money-gate';
import { paymentFieldErrors } from '@/lib/engagements/payment-field-rules';
import { FormActions } from './engagement-form-actions';
import { FormRefusal } from './form-refusal';
import type { RunAction } from './use-engagement-action';
import { usePaymentFormSubmit } from './use-payment-form-submit';

/** What this form renders; a refusal about anything else is said above Save. */
const HERO_PAYMENT_FIELDS = ['amount', 'method', 'reference'] as const;

/**
 * The hero's combined "Log payment & advance". Owns the amount, method and
 * reference; the idempotency key is NOT its own.
 *
 * ONE KEY PER DELIBERATE ACT. This minted a key per MOUNT, and the only thing
 * bounding it was the `key={paymentItem.amountDue}` remount the command card
 * does when a SHORT payment revalidates the due down. Everything else the studio
 * could change in place — the amount they typed over the prefill, the method,
 * the reference — travelled on the same key, and `payments.ts` answers a
 * repeated key with the ORIGINAL row and `ok`: the second figure was discarded
 * and the form closed as though it had saved.
 *
 * So the key comes from `runAction`, exactly as it does for the Payments tab's
 * panel and the lifecycle triggers: claimed at SUBMIT, named by EVERY field this
 * request carries, HELD across a retry of the same request after an answer that
 * could not say what happened, released the moment the server says it worked or
 * definitely refused. A value the rules refuse is said under its field before
 * anything is sent, so it never claims a key at all.
 *
 * `mode` is the card's money button: `payAndAdvance`, or `recordOnly` at the
 * ending choice, where logging the balance must never pick an ending. The submit
 * for both lives in `use-payment-form-submit.ts`.
 */
export function PaymentForm({
  engagementId,
  paymentKind,
  defaultAmount,
  mode,
  advanceTrigger,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  paymentKind: NonNullable<(typeof MONEY_GUARD_MILESTONE)[keyof typeof MONEY_GUARD_MILESTONE]>;
  defaultAmount: string;
  mode: Exclude<PayCtaMode, null>;
  advanceTrigger: EngagementGatePreview['primaryTrigger'];
  pending: boolean;
  runAction: RunAction;
  onDone: () => void;
}) {
  const th = useTranslations('engagements.hero');
  const tc = useTranslations('engagements.controls');
  const te = useTranslations('errors');
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const errors = useFieldErrors({ fields: HERO_PAYMENT_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);
  // Amount is the one field up front; method + reference are optional detail
  // tucked behind a disclosure, which opens by itself when one of them is
  // refused (D6). The submit payload is IDENTICAL either way.
  const [detailsChosen, setDetailsChosen] = useState(false);
  const detailsOpen =
    detailsChosen || Boolean(errors.messageFor('method') || errors.messageFor('reference'));

  const submitPayment = usePaymentFormSubmit({
    engagementId,
    paymentKind,
    mode,
    advanceTrigger,
    runAction,
    onDone,
  });
  function submit() {
    if (errors.applyLocal(paymentFieldErrors({ amount, method, reference }))) return;
    submitPayment({ amount, method, reference }, errors);
  }

  return (
    <div
      ref={formRef}
      className="mt-4 space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      <FormField id="hero-pay-amount" label={tc('amount')} {...errors.bind('amount')}>
        <Input
          dir="ltr"
          inputMode="decimal"
          className="tabular-nums"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>

      {detailsOpen ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="hero-pay-method" label={tc('method')} {...errors.bind('method')}>
            <Input value={method} onChange={(event) => setMethod(event.target.value)} />
          </FormField>
          <FormField id="hero-pay-reference" label={tc('reference')} {...errors.bind('reference')}>
            <Input
              dir="ltr"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </FormField>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDetailsChosen(true)}
          className="text-small font-semibold text-brand-ink hover:underline"
        >
          + {tc('addDetails')}
        </button>
      )}
      <FormRefusal message={errors.formError} />
      <FormActions
        pending={pending}
        onCancel={onDone}
        onSave={submit}
        saveLabel={mode === 'recordOnly' ? th('logPayment') : th('logPaymentAdvance')}
        cancelLabel={tc('cancel')}
      />
    </div>
  );
}
