'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type { Trigger } from '@/lib/engagements/transitions';
import { triggerNeedsForm } from '@/lib/engagements/ui';
import { EngagementFeeForm } from './engagement-fee-form';
import { EngagementRevisionForm } from './engagement-revision-form';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';

// The command card's LOW-EMPHASIS secondary controls: every legal, capability-
// permitted trigger that is NOT the forward-advance one (the Advance button owns
// that). Folds in the retired `engagement-next-actions.tsx` — rejectDesign,
// requestRevision, attest/flag as-built, etc. — as small outline buttons so no
// legal trigger is dropped. A payload trigger opens its existing form; `abandon`
// is confirm-gated (first click reveals an inline title/hint + Confirm/Cancel;
// only Confirm fires — abandoning is terminal and irreversible); every other
// trigger fires directly through the shared `trigger-actions` map.
export function EngagementSecondaryActions({
  engagementId,
  triggers,
  revisionCount,
  freeRevisionN,
  pending,
  runAction,
}: {
  engagementId: string;
  triggers: Trigger[];
  revisionCount: number;
  freeRevisionN: number;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const tcmd = useTranslations('engagements.command');
  const tt = useTranslations('engagements.trigger');
  const [openForm, setOpenForm] = useState<'submitDesignFee' | 'requestRevision' | null>(
    null,
  );
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

  if (triggers.length === 0) return null;

  function onClick(trigger: Trigger) {
    if (triggerNeedsForm(trigger)) {
      setOpenForm(trigger as 'submitDesignFee' | 'requestRevision');
      return;
    }
    // Abandon is terminal: the first click only reveals the inline confirm —
    // nothing fires until the Confirm button below is pressed.
    if (trigger === 'abandon') {
      setConfirmingAbandon((open) => !open);
      return;
    }
    const fn = DIRECT_TRIGGER_ACTIONS[trigger];
    if (fn) runAction(() => fn(engagementId));
  }

  function fireAbandon() {
    const fn = DIRECT_TRIGGER_ACTIONS.abandon;
    if (!fn) return;
    runAction(async () => {
      const res = await fn(engagementId);
      if (res.ok) setConfirmingAbandon(false);
      return res;
    });
  }

  return (
    <div className="mt-5 space-y-3 border-t border-[color:var(--rule)] pt-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
        {tcmd('moreLabel')}
      </p>
      <div className="flex flex-wrap gap-2">
        {triggers.map((trigger) => (
          <Button
            key={trigger}
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onClick(trigger)}
          >
            {tt(trigger)}
          </Button>
        ))}
      </div>

      {confirmingAbandon && (
        <div
          className="space-y-2 rounded-[var(--r-item)] border border-[color:var(--warn-tint)] bg-[color:var(--track)] p-4"
          role="alertdialog"
          aria-label={tcmd('abandonConfirmTitle')}
        >
          <p className="text-[13px] font-semibold">{tcmd('abandonConfirmTitle')}</p>
          <p className="text-[12.5px] text-[color:var(--text-muted)]">
            {tcmd('abandonConfirmHint')}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={fireAbandon}
            >
              {tcmd('abandonConfirmCta')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmingAbandon(false)}
            >
              {tcmd('abandonConfirmCancel')}
            </Button>
          </div>
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
        <EngagementRevisionForm
          engagementId={engagementId}
          revisionCount={revisionCount}
          freeRevisionN={freeRevisionN}
          pending={pending}
          runAction={runAction}
          onCancel={() => setOpenForm(null)}
        />
      )}
    </div>
  );
}
