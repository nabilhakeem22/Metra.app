'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { Trigger } from '@/lib/engagements/transitions';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';
import type { RunAction } from './use-engagement-action';

/**
 * THE TWO ENDINGS, as equal choices. At `execution_decision` there is no single
 * forward move: the client either builds with the studio or takes the design
 * only, and both are final. So neither is the default: the two buttons share one
 * variant and one size, and each asks for confirmation before it fires. Cancel
 * fires nothing.
 */
export function CommandCardEndings({
  engagementId,
  endings,
  enabled,
  pending,
  runAction,
}: {
  engagementId: string;
  endings: Trigger[];
  enabled: boolean;
  pending: boolean;
  runAction: RunAction;
}) {
  const tending = useTranslations('engagements.command.ending');
  const { confirm, dialog } = useConfirm();

  async function choose(trigger: Trigger): Promise<void> {
    const action = DIRECT_TRIGGER_ACTIONS[trigger];
    if (!action) return;
    const confirmed = await confirm({
      title: tending(`${trigger}.confirmTitle`),
      description: tending(`${trigger}.confirmBody`),
      confirmLabel: tending(`${trigger}.cta`),
      cancelLabel: tending('cancel'),
    });
    if (!confirmed) return;
    runAction((idempotencyKey) => action(engagementId, idempotencyKey), trigger);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {endings.map((trigger) => (
          <Button
            key={trigger}
            type="button"
            className="w-full"
            disabled={!enabled || pending}
            onClick={() => void choose(trigger)}
          >
            {tending(`${trigger}.cta`)}
          </Button>
        ))}
      </div>
      {dialog}
    </>
  );
}
