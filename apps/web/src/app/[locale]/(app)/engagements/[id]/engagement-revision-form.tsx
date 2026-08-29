'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { requestRevision } from '@/lib/engagements/actions';

// The revision-request payload form (an optional reason + the change-order amount
// that becomes required once a revision crosses the free allowance). Extracted from
// the retired `engagement-next-actions.tsx` so the command card's low-emphasis
// secondary controls can open it unchanged. Flat tray (opaque `--track` fill, no
// `.glass`) so it never nests a backdrop-filter inside the glass command card.
export function EngagementRevisionForm({
  engagementId,
  revisionCount,
  freeRevisionN,
  pending,
  runAction,
  onCancel,
}: {
  engagementId: string;
  // The revision counter + the free allowance drive whether a change-order amount
  // is even solicited: a revision still within the free allowance never raises a
  // charge, so the amount field is hidden AND submitted as undefined.
  revisionCount: number;
  freeRevisionN: number;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.revisionForm');
  const tc = useTranslations('engagements.controls');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  // This next revision crosses the free allowance → it will raise a change order,
  // which requires a positive amount. Within the allowance the field is omitted.
  const amountRequired = revisionCount >= freeRevisionN;

  function submit() {
    runAction(() =>
      requestRevision(engagementId, {
        reason: reason.trim() || undefined,
        changeOrderAmount: amountRequired ? amount.trim() || undefined : undefined,
      }),
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <p className="text-sm font-medium">{t('title')}</p>
      <div className="space-y-1.5">
        <Label htmlFor="rev-reason">{t('reason')}</Label>
        <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {amountRequired && (
        <div className="space-y-1.5">
          <Label htmlFor="rev-amount">{t('addAmount')}</Label>
          <Input
            id="rev-amount"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {tc('cancel')}
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('submit')}
        </Button>
      </div>
    </div>
  );
}
