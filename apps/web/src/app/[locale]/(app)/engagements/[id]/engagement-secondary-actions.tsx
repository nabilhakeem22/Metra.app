'use client';

import { Ban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import type { ActionResult } from '@/lib/actions/result';
import {
  isRevisionTrigger,
  type RevisionAllowances,
  type RevisionTrigger,
} from '@/lib/engagements/revision-allowance';
import type { Trigger } from '@/lib/engagements/transitions';
import { triggerNeedsForm } from '@/lib/engagements/ui';
import { EngagementRevisionForm } from './engagement-revision-form';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';
import { SectionLabel } from '@/components/ui/section-label';

/** The payload triggers that can be secondary — each opens a form here instead of
 *  firing. `submitDesignFee` is not one: it is only legal from `created`, where it
 *  is always the card's forward move. */
type PayloadFormTrigger = RevisionTrigger;

// The command card's LOW-EMPHASIS secondary controls: every legal, capability-
// permitted trigger that is NOT the forward-advance one (the Advance button owns
// that). Folds in the retired `engagement-next-actions.tsx` — rejectDesign,
// requestRevision, designChangeRaised (revise & re-issue the 3D), attest/flag
// as-built, etc., as small secondary buttons so no legal trigger is dropped. A
// payload trigger opens its existing form; every other trigger fires directly
// through the shared `trigger-actions` map. `abandon` is the exception: it is
// terminal and irreversible, so it is not a button at all but the destructive
// item of a menu at the end of the row, and it fires only after a confirm.
export function EngagementSecondaryActions({
  engagementId,
  triggers,
  allowances,
  pending,
  runAction,
}: {
  engagementId: string;
  triggers: Trigger[];
  /** Both revision counter/allowance pairs — the open form picks its own. */
  allowances: RevisionAllowances;
  pending: boolean;
  /** Runs one server action with the page's per-attempt idempotency key
   *  (0050). Ignore the argument on an edge that does not need one. */
  runAction: (
    fn: (idempotencyKey: string) => Promise<ActionResult>,
    trigger?: Trigger,
  ) => void;
}) {
  const tcmd = useTranslations('engagements.command');
  const tt = useTranslations('engagements.trigger');
  const tc = useTranslations('common');
  const [openForm, setOpenForm] = useState<PayloadFormTrigger | null>(null);
  const { confirm, dialog } = useConfirm();

  if (triggers.length === 0) return null;
  const buttonTriggers = triggers.filter((trigger) => trigger !== 'abandon');

  function onClick(trigger: Trigger) {
    if (triggerNeedsForm(trigger)) {
      setOpenForm(trigger as PayloadFormTrigger);
      return;
    }
    const fn = DIRECT_TRIGGER_ACTIONS[trigger];
    if (fn) runAction((idempotencyKey) => fn(engagementId, idempotencyKey), trigger);
  }

  async function confirmAbandon() {
    const confirmed = await confirm({
      title: tcmd('abandonConfirmTitle'),
      description: tcmd('abandonConfirmHint'),
      confirmLabel: tcmd('abandonConfirmCta'),
      cancelLabel: tcmd('abandonConfirmCancel'),
      variant: 'destructive',
    });
    const fn = DIRECT_TRIGGER_ACTIONS.abandon;
    if (confirmed && fn) runAction(() => fn(engagementId));
  }

  return (
    <div className="mt-5 space-y-3 border-t border-[color:var(--rule)] pt-4">
      <SectionLabel>{tcmd('moreLabel')}</SectionLabel>
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        {buttonTriggers.map((trigger) => (
          <Button
            key={trigger}
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => onClick(trigger)}
          >
            {tt(trigger)}
          </Button>
        ))}
        {triggers.includes('abandon') && (
          <OverflowMenu
            label={tc('moreActions')}
            disabled={pending}
            actions={[
              {
                key: 'abandon',
                label: tt('abandon'),
                icon: Ban,
                destructive: true,
                onSelect: () => void confirmAbandon(),
              },
            ]}
          />
        )}
      </div>

      {/* One form for BOTH revision edges — the concept self-loop and the 3D
          revision loop — keyed by the trigger so switching between them resets
          the fields rather than carrying the previous reason/amount over. The
          trigger also selects which of the two independent allowances applies. */}
      {openForm !== null && isRevisionTrigger(openForm) && (
        <EngagementRevisionForm
          key={openForm}
          engagementId={engagementId}
          trigger={openForm}
          allowances={allowances}
          pending={pending}
          runAction={runAction}
          onCancel={() => setOpenForm(null)}
        />
      )}
    </div>
  );
}
