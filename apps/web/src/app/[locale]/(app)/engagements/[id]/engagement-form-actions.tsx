'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The Save/Cancel pair every cockpit panel form ends with.
 *
 * The double-submit guard is NOT here. It belongs to `runAction` in
 * `engagement-detail-client.tsx`, which owns the transition — this component is
 * one of five entry points into it, and the other eight (Advance, the off-plan
 * toggle, the revision form, the payment form, every secondary trigger including
 * the terminal `abandon`) would have been left unguarded by a latch that lived
 * here.
 *
 * CANCEL IS NEVER DISABLED. It closes a panel and calls no action, so disabling it
 * while `pending` only means a user whose write has hung cannot close the form
 * they are stuck in.
 */
export function FormActions({
  pending,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
}: {
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {saveLabel}
      </Button>
    </div>
  );
}
