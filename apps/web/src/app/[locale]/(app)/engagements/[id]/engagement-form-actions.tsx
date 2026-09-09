'use client';

import { Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The Save/Cancel pair every cockpit panel form ends with.
 *
 * IT OWNS THE DOUBLE-SUBMIT LATCH, and that is the point of it being shared.
 * `pending` comes from a `useTransition`, which only flips on a SUBSEQUENT
 * render — so two clicks inside one frame both see `pending === false` and both
 * dispatch. That was harmless while every panel's action was an idempotent column
 * write. It stopped being harmless the moment those actions began appending to an
 * append-only ledger: `engagement_events` grants INSERT and SELECT and nothing
 * else, so a row written twice cannot be written back.
 *
 * The latch closes the frame-sized window `pending` cannot. It lives here rather
 * than in one form because the exposure is not one form's: `setEngagementRom` has
 * it, and so does the staff on-behalf acknowledgement next door — 0033's partial
 * unique index is scoped `WHERE actor_channel = 'client'`, so nothing at the
 * database level constrains a duplicate written by staff.
 *
 * The latch releases when `pending` transitions back to false — the action has
 * settled and a new submit is legitimate again.
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
  const latched = useRef(false);
  // Track `pending` across renders: once the transition has picked the submission
  // up it guards it, and when it settles the latch opens for a genuine re-submit.
  const wasPending = useRef(false);
  if (wasPending.current && !pending) latched.current = false;
  wasPending.current = pending;

  function save() {
    if (latched.current || pending) return;
    latched.current = true;
    onSave();
  }

  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="button" size="sm" onClick={save} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {saveLabel}
      </Button>
    </div>
  );
}
