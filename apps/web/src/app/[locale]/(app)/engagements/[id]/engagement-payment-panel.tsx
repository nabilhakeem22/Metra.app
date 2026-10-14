'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { MilestoneKind, PaymentEventKind } from '@metra/db';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { toast } from '@/hooks/use-toast';
import { recordPayment } from '@/lib/engagements/actions';
import { PAYMENT_HELD_TRIGGER, actOf } from '@/lib/engagements/held-act';
import { paymentFieldErrors } from '@/lib/engagements/payment-field-rules';
import type { RecordPaymentInput } from '@/lib/engagements/payments';
import { FormActions } from './engagement-form-actions';
import { FormRefusal } from './form-refusal';
import type { RunAction } from './use-engagement-action';

/** The panel renders the amount; a refusal about anything else is said above Save. */
const PANEL_FIELDS = ['amount'] as const;

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const PAYMENT_KINDS: PaymentEventKind[] = ['deposit', 'gate_a', 'gate_b', 'balance', 'revision_co'];

/**
 * Standalone "record a payment" panel. Owns its own kind/amount state; the
 * idempotency key is NOT its own.
 *
 * ONE KEY PER DELIBERATE ACT, not one per panel open. A key minted at mount and
 * reused for everything typed into that open panel meant two genuinely different
 * payments — EGP 50,000, then EGP 75,000 without closing the panel — went to the
 * server on ONE key, and `payments.ts` answers a repeated key with the ORIGINAL
 * row and `ok`, so the second payment was discarded and the panel closed as
 * though it had saved.
 *
 * So the key comes from `runAction`, on exactly the discipline the lifecycle
 * triggers use: minted at SUBMIT for this kind + amount, HELD (for fifteen
 * minutes) across a retry of the same figures after an answer that could not say
 * what happened, and released the moment the server says it worked or definitely
 * refused. CHANGING THE AMOUNT AFTER AN 'uncertain' IS A NEW ACT and gets a new
 * key: the refusal tells the studio to refresh and check before trying again, so
 * a studio who comes back and types a different figure is recording something
 * else — see HeldKey.act. An amount the rules refuse is said under the box
 * before anything is sent, so it never claims a key.
 */
export function PaymentPanel({
  engagementId,
  claimedMilestones,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  /**
   * Milestones the client has reported paying and the studio has not answered.
   * The server refuses a hand-logged payment for one (`claim_pending_for_milestone`,
   * it would count the same money twice), so the form says so before Save.
   */
  claimedMilestones: readonly MilestoneKind[];
  pending: boolean;
  runAction: RunAction;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const tk = useTranslations('engagements.paymentKind');
  const te = useTranslations('errors');
  const [payKind, setPayKind] = useState<PaymentEventKind>('deposit');
  const [payAmount, setPayAmount] = useState('');
  const claimPending = (claimedMilestones as readonly PaymentEventKind[]).includes(payKind);
  const errors = useFieldErrors({ fields: PANEL_FIELDS, translate: te });
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(panelRef, errors.invalidAttempt);

  function save() {
    if (errors.applyLocal(paymentFieldErrors({ amount: payAmount }))) return;
    // THE REQUEST, minus its key: one object, used twice. The three fields this
    // panel does not offer are `undefined` rather than absent — `actOf` is typed
    // against the request, so the day one of them is added here it must be named
    // in the act as well or the build fails.
    const submitted = {
      engagementId,
      kind: payKind,
      amount: payAmount.trim(),
      method: undefined,
      reference: undefined,
      note: undefined,
    };
    runAction(
      async (idempotencyKey) => {
        const res = await recordPayment({ ...submitted, idempotencyKey });
        // `already` MEANS THE LEDGER WAS NOT APPENDED. `payments.ts` answers a
        // repeated key with the ORIGINAL row and `ok`, and until now this panel
        // closed on that exactly as it closes on a fresh write — so the one case
        // where the studio most needs to know what happened was the one case
        // that looked identical to every other success. The server has been
        // saying so since 0050; nobody was reading it.
        if (res.ok && res.already) {
          toast({ title: t('alreadyRecorded'), description: t('alreadyRecordedHint') });
        }
        if (res.ok) onDone();
        return res;
      },
      PAYMENT_HELD_TRIGGER,
      actOf<Omit<RecordPaymentInput, 'idempotencyKey'>>(submitted),
      errors,
    );
  }

  return (
    <div
      ref={panelRef}
      className="space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4"
    >
      {/* Kind is UP FRONT alongside amount — it drives the milestone gates and the
          ledger is append-only, so it is not optional metadata to be tucked away. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="pay-kind" label={t('kind')}>
          <SelectControl
            value={payKind}
            onValueChange={(v) => setPayKind(v as PaymentEventKind)}
            options={PAYMENT_KINDS.map((k) => ({ value: k, label: tk(k) }))}
          />
        </FormField>
        <FormField id="pay-amount" label={t('amount')} {...errors.bind('amount')}>
          <Input
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
          />
        </FormField>
      </div>
      <FormRefusal message={errors.formError} />
      {claimPending && (
        <p className="text-small text-[color:var(--text-muted)]">{t('claimPending')}</p>
      )}
      <FormActions
        pending={pending}
        onCancel={onDone}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
        saveDisabled={claimPending}
      />
    </div>
  );
}
