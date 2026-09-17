'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PaymentEventKind } from '@metra/db';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { recordPayment } from '@/lib/engagements/actions';
import { PAYMENT_HELD_TRIGGER } from '@/lib/engagements/held-key';
import { FormActions } from './engagement-form-actions';
import type { RunAction } from './use-engagement-action';

/** How much of a typed amount names the act. A money string the server accepts
 *  is under 20 characters; this only bounds what a paste can put in storage. */
const MAX_ACT_AMOUNT_CHARS = 40;

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const PAYMENT_KINDS: PaymentEventKind[] = [
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
  'revision_co',
];

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
 * else — see HeldKey.act.
 */
export function PaymentPanel({
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  pending: boolean;
  runAction: RunAction;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const tk = useTranslations('engagements.paymentKind');
  const [payKind, setPayKind] = useState<PaymentEventKind>('deposit');
  const [payAmount, setPayAmount] = useState('');

  function save() {
    const amount = payAmount.trim();
    runAction(
      async (idempotencyKey) => {
        const res = await recordPayment({
          engagementId,
          kind: payKind,
          amount,
          idempotencyKey,
        });
        if (res.ok) onDone();
        return res;
      },
      PAYMENT_HELD_TRIGGER,
      // WHAT THIS ACT IS. Capped, because the field is free text and this string
      // is mirrored to sessionStorage; every amount the server can accept is far
      // shorter, so two inputs can only collide past the cap if both are refused.
      `${payKind}|${amount.slice(0, MAX_ACT_AMOUNT_CHARS)}`,
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      {/* Kind is UP FRONT alongside amount — it drives the milestone gates and the
          ledger is append-only, so it is not optional metadata to be tucked away. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pay-kind">{t('kind')}</Label>
          <Select
            value={payKind}
            onValueChange={(v) => setPayKind(v as PaymentEventKind)}
          >
            <SelectTrigger id="pay-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {tk(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pay-amount">{t('amount')}</Label>
          <Input
            id="pay-amount"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
          />
        </div>
      </div>
      <FormActions
        pending={pending}
        onCancel={onDone}
        onSave={save}
        saveLabel={t('save')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
