'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { requestRevision } from '@/lib/engagements/actions';
import { triggerNeedsForm } from '@/lib/engagements/ui';
import type { Trigger } from '@/lib/engagements/transitions';
import { EngagementFeeForm } from './engagement-fee-form';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';

export function EngagementNextActions({
  engagementId,
  triggers,
  pending,
  runAction,
}: {
  engagementId: string;
  triggers: Trigger[];
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const tt = useTranslations('engagements.trigger');
  const [openForm, setOpenForm] = useState<'submitDesignFee' | 'requestRevision' | null>(
    null,
  );

  function onClick(trigger: Trigger) {
    if (triggerNeedsForm(trigger)) {
      setOpenForm(trigger as 'submitDesignFee' | 'requestRevision');
      return;
    }
    const fn = DIRECT_TRIGGER_ACTIONS[trigger];
    if (fn) runAction(() => fn(engagementId));
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-medium">{t('nextActions.title')}</p>
        {triggers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('nextActions.none')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {triggers.map((trigger) => (
              <Button
                key={trigger}
                type="button"
                variant={trigger === 'rejectDesign' ? 'outline' : 'default'}
                size="sm"
                disabled={pending}
                onClick={() => onClick(trigger)}
              >
                {tt(trigger)}
              </Button>
            ))}
          </div>
        )}

        {openForm === 'submitDesignFee' && (
          <EngagementFeeForm
            engagementId={engagementId}
            pending={pending}
            onSubmit={(fn) => runAction(fn)}
            onCancel={() => setOpenForm(null)}
          />
        )}

        {openForm === 'requestRevision' && (
          <RevisionForm
            engagementId={engagementId}
            pending={pending}
            runAction={runAction}
            onCancel={() => setOpenForm(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RevisionForm({
  engagementId,
  pending,
  runAction,
  onCancel,
}: {
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.revisionForm');
  const tc = useTranslations('engagements.controls');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');

  function submit() {
    runAction(() =>
      requestRevision(engagementId, {
        reason: reason.trim() || undefined,
        changeOrderAmount: amount.trim() || undefined,
      }),
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-medium">{t('title')}</p>
        <div className="space-y-2">
          <Label htmlFor="rev-reason">{t('reason')}</Label>
          <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rev-amount">{t('changeOrderAmount')}</Label>
          <Input
            id="rev-amount"
            dir="ltr"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('submit')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
