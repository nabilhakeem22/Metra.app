'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { logPaymentAndAdvance } from '@/lib/engagements/actions';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards';

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
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const th = useTranslations('engagements.hero');
  const tc = useTranslations('engagements.controls');
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  // One idempotency key per mounted form. The `key={paymentItem.amountDue}`
  // remount (a short-payment revalidation) mints a FRESH key for the genuinely
  // new payment, while a double-click within one open reuses this one — so a
  // blind re-click records the same payment once, not twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  function submit() {
    if (!advanceTrigger) return;
    runAction(async () => {
      const res = await logPaymentAndAdvance(engagementId, {
        paymentKind,
        amount: amount.trim(),
        method: method.trim() || null,
        reference: reference.trim() || null,
        advanceTrigger,
        idempotencyKey,
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="mt-4 space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
