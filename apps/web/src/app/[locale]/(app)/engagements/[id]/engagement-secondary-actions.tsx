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
// legal trigger is dropped. A payload trigger opens its existing form; every other
// fires directly through the shared `trigger-actions` map.
export function EngagementSecondaryActions({
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

  if (triggers.length === 0) return null;

  function onClick(trigger: Trigger) {
    if (triggerNeedsForm(trigger)) {
      setOpenForm(trigger as 'submitDesignFee' | 'requestRevision');
      return;
    }
    const fn = DIRECT_TRIGGER_ACTIONS[trigger];
    if (fn) runAction(() => fn(engagementId));
  }

  return (
    <div className="mt-5 space-y-3 border-t border-[color:var(--rule)] pt-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
        {t('nextActions.title')}
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
          pending={pending}
          runAction={runAction}
          onCancel={() => setOpenForm(null)}
        />
      )}
    </div>
  );
}
