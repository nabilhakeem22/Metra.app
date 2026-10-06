'use client';

import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import type { ActionResult } from '@/lib/actions/result';
import type { PayCtaMode } from '@/lib/engagements/command-card-ctas';
import { logPaymentAndAdvance, recordPayment } from '@/lib/engagements/actions';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import {
  PAYMENT_HELD_TRIGGER,
  PAY_AND_ADVANCE_HELD_TRIGGER,
  actOf,
} from '@/lib/engagements/held-act';
import type { LogPaymentAndAdvanceInput } from '@/lib/engagements/pay-and-advance';
import type { RecordPaymentInput } from '@/lib/engagements/payments';
import type { PaymentEventKind } from '@metra/db';
import type { RunAction } from './use-engagement-action';

/** What the studio typed: the amount, plus the optional method and reference. */
export interface PaymentFormFields {
  amount: string;
  method: string;
  reference: string;
}

/**
 * The hero payment form's SUBMIT, for both of its modes.
 *
 * `payAndAdvance` records the payment and fires the forward trigger, under the
 * combined control's held-key name. `recordOnly` (the ending choice) calls
 * `recordPayment` and never advances, under the SAME held-key name and the SAME
 * `actOf` request shape the Payments tab uses, so one payment is one act
 * whichever of the two controls recorded it.
 *
 * Either way the key comes from `runAction`: claimed at submit, named by every
 * field the request carries, held across a retry after an answer that could not
 * say what happened. `already` means the ledger was NOT appended (the original
 * row was handed back), and the studio is told so.
 */
export function usePaymentFormSubmit(options: {
  engagementId: string;
  paymentKind: PaymentEventKind;
  mode: Exclude<PayCtaMode, null>;
  advanceTrigger: EngagementGatePreview['primaryTrigger'];
  runAction: RunAction;
  onDone: () => void;
}): (fields: PaymentFormFields) => void {
  const tc = useTranslations('engagements.controls');
  const { engagementId, paymentKind, mode, advanceTrigger, runAction, onDone } = options;

  function settle(res: ActionResult): ActionResult {
    if (res.ok && res.already) {
      toast({ title: tc('alreadyRecorded'), description: tc('alreadyRecordedHint') });
    }
    if (res.ok) onDone();
    return res;
  }

  function submitRecordOnly(fields: PaymentFormFields): void {
    const submitted = {
      engagementId,
      kind: paymentKind,
      amount: fields.amount.trim(),
      method: fields.method.trim() || null,
      reference: fields.reference.trim() || null,
      note: undefined,
    };
    runAction(
      async (idempotencyKey) => settle(await recordPayment({ ...submitted, idempotencyKey })),
      PAYMENT_HELD_TRIGGER,
      actOf<Omit<RecordPaymentInput, 'idempotencyKey'>>(submitted),
    );
  }

  function submitPayAndAdvance(fields: PaymentFormFields): void {
    if (!advanceTrigger) return;
    // THE REQUEST, minus its key: one object, used twice. `actOf` is typed
    // against the same shape, so a field added to the request and forgotten in
    // the fingerprint does not compile.
    const submitted = {
      paymentKind,
      amount: fields.amount.trim(),
      method: fields.method.trim() || null,
      reference: fields.reference.trim() || null,
      advanceTrigger,
    };
    runAction(
      async (idempotencyKey) =>
        settle(await logPaymentAndAdvance(engagementId, { ...submitted, idempotencyKey })),
      PAY_AND_ADVANCE_HELD_TRIGGER,
      actOf<Omit<LogPaymentAndAdvanceInput, 'idempotencyKey'>>(submitted),
    );
  }

  return mode === 'recordOnly' ? submitRecordOnly : submitPayAndAdvance;
}
