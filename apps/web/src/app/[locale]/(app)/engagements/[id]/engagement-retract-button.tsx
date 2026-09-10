'use client';

import { Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { recordEventCorrection } from '@/lib/engagements/actions';

/**
 * Retract one ledger row.
 *
 * TWO CLICKS, AND A REASON. The first reveals the form; only the second writes.
 * The pattern is the `abandon` trigger's, and for the same reason: this appends
 * to a ledger that grants INSERT and SELECT and nothing else, so the retraction
 * is itself permanent. There is no undoing an undo.
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
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--text-muted)] hover:text-[color:var(--danger)] disabled:opacity-60"
      >
        <Undo2 className="size-3" aria-hidden />
        {t('retract')}
      </button>
    );
  }

  return (
    <div
      className="mt-2 space-y-2 rounded-[var(--r-item)] border border-[color:var(--danger)] p-3"
      role="alertdialog"
      aria-label={t('retractTitle')}
    >
      <p className="text-[12px] text-[color:var(--text)]">{t('retractHint')}</p>
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
          variant="destructive"
          size="sm"
          disabled={pending || reason.trim().length === 0}
          onClick={() =>
            runAction(async () => {
              const res = await recordEventCorrection({
                engagementId,
                eventId,
                reason,
              });
              if (res.ok) setOpen(false);
              return res;
            })
          }
        >
          {t('retractConfirm')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(false)}
        >
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}
