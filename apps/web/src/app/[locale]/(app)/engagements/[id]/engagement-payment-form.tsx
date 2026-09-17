'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { logPaymentAndAdvance } from '@/lib/engagements/actions';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { PAY_AND_ADVANCE_HELD_TRIGGER, actOf } from '@/lib/engagements/held-act';
import type { LogPaymentAndAdvanceInput } from '@/lib/engagements/pay-and-advance';
// Leaf import (guards/trigger-money-gate), not the barrel — the barrel also pulls
// GUARDS from ./registry into this client chunk (heavy, cycle-prone, can init a
// binding as undefined at render). The leaf is the pure MONEY_GUARD_MILESTONE map
// and the trigger lookup beside it.
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards/trigger-money-gate';
import type { RunAction } from './use-engagement-action';

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
 * definitely refused. The remount keeps doing its own job (re-deriving the
 * prefill from the smaller due); it is no longer what makes the key honest.
 */
export function PaymentForm({
  engagementId,
  paymentKind,
  defaultAmount,
  advanceTrigger,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  paymentKind: NonNullable<(typeof MONEY_GUARD_MILESTONE)[keyof typeof MONEY_GUARD_MILESTONE]>;
  defaultAmount: string;
  advanceTrigger: EngagementGatePreview['primaryTrigger'];
  pending: boolean;
  runAction: RunAction;
  onDone: () => void;
}) {
  const th = useTranslations('engagements.hero');
  const tc = useTranslations('engagements.controls');
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  // Amount is the one field up front; method + reference are optional detail
  // tucked behind a disclosure. The submit payload is IDENTICAL either way —
  // an unopened disclosure just leaves them empty (trimmed to null below).
  const [detailsOpen, setDetailsOpen] = useState(false);

  function submit() {
    if (!advanceTrigger) return;
    // THE REQUEST, minus its key: one object, used twice. `actOf` is typed
    // against the same shape, so a field added to the request and forgotten in
    // the fingerprint does not compile.
    const submitted = {
      paymentKind,
      amount: amount.trim(),
      method: method.trim() || null,
      reference: reference.trim() || null,
      advanceTrigger,
    };
    runAction(
      async (idempotencyKey) => {
        const res = await logPaymentAndAdvance(engagementId, { ...submitted, idempotencyKey });
        if (res.ok) onDone();
        return res;
      },
      PAY_AND_ADVANCE_HELD_TRIGGER,
      actOf<Omit<LogPaymentAndAdvanceInput, 'idempotencyKey'>>(submitted),
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <div className="space-y-1.5">
        <Label htmlFor="hero-pay-amount">{tc('amount')}</Label>
        <Input
          id="hero-pay-amount"
          dir="ltr"
          inputMode="decimal"
          className="tabular-nums"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>

      {detailsOpen ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hero-pay-method">{tc('method')}</Label>
            <Input
              id="hero-pay-method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hero-pay-reference">{tc('reference')}</Label>
            <Input
              id="hero-pay-reference"
              dir="ltr"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          className="text-[12.5px] font-semibold text-brand-ink hover:underline"
        >
          + {tc('addDetails')}
        </button>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={pending}>
          {tc('cancel')}
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {th('logPaymentAdvance')}
        </Button>
      </div>
    </div>
  );
}
