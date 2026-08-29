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
import type { ActionResult } from '@/lib/actions/result';
import { recordPayment } from '@/lib/engagements/actions';
import { FormActions } from './engagement-form-actions';

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
 * Standalone "record a payment" panel. Owns its own kind/amount state and — one
 * per mount — an idempotency key: a fresh mount per panel-open means one key per
 * open, so a double-click within a single open records the payment exactly once
 * (the partial unique index dedups the retry). Closing + reopening the panel is a
 * new mount = a new key = a genuinely new payment.
 */
export function PaymentPanel({
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  const tk = useTranslations('engagements.paymentKind');
  const [payKind, setPayKind] = useState<PaymentEventKind>('deposit');
  const [payAmount, setPayAmount] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  function save() {
    runAction(async () => {
      const res = await recordPayment({
        engagementId,
        kind: payKind,
        amount: payAmount.trim(),
        idempotencyKey,
      });
      if (res.ok) onDone();
      return res;
    });
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
