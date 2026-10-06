'use client';

import { Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { recordEventCorrection } from '@/lib/engagements/actions';

/**
 * Retract one ledger row.
 *
 * A REASON, THEN A CONFIRM. The first click reveals the reason field; Retract
 * then asks through ConfirmDialog (the one place the destructive button lives),
 * as `abandon` does, and only its confirm writes: this appends to a ledger that
 * grants INSERT and SELECT and nothing else, so the retraction is itself
 * permanent. There is no undoing an undo.
 *
 * The reason is REQUIRED, not optional — the server rejects a blank one. A
 * retraction with no stated cause is just a disappearance, and the entire reason
 * to correct rather than delete is that the record explains itself to whoever
 * reads it next.
 *
 * Offered only to owner and admin (`engagements_issue`), and the action re-checks
 * regardless: recording what a client said is routine studio work, unsaying it
 * afterwards is not.
 */
export function RetractButton({
  engagementId,
  eventId,
  pending,
  runAction,
}: {
  engagementId: string;
  eventId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements.timeline');
  const tc = useTranslations('engagements.controls');
  const tcommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { confirm, dialog } = useConfirm();

  async function retract(): Promise<void> {
    const confirmed = await confirm({
      title: t('retractTitle'),
      description: t('retractHint'),
      confirmLabel: t('retractConfirm'),
      cancelLabel: tcommon('cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    runAction(async () => {
      const res = await recordEventCorrection({ engagementId, eventId, reason });
      if (res.ok) setOpen(false);
      return res;
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="inline-flex items-center gap-1 text-caption font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--danger)] disabled:opacity-60"
      >
        <Undo2 className="size-3" aria-hidden />
        {t('retract')}
      </button>
    );
  }

  return (
    <div
      className="mt-2 space-y-2 rounded-item border border-[color:var(--rule)] p-3"
      role="group"
      aria-label={t('retractTitle')}
    >
      {dialog}
      <div className="space-y-1.5">
        <Label htmlFor={`retract-${eventId}`}>{t('retractReason')}</Label>
        <Input
          id={`retract-${eventId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || reason.trim().length === 0}
          onClick={() => void retract()}
        >
          {t('retractConfirm')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(false)}
        >
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}
