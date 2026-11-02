'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';
import type { RunAction } from './use-engagement-action';

/**
 * A design-only delivery whose client later decides to build continues on the
 * same row, so the same link (lib/engagements/design-first.ts). Behind a confirm,
 * as the endings are: Cancel fires nothing. The client's consent is signing the
 * contract that follows.
 */
export function CommandCardContinueExecution({
  engagementId,
  pending,
  runAction,
}: {
  engagementId: string;
  pending: boolean;
  runAction: RunAction;
}) {
  const t = useTranslations('engagements.command.continueExecution');
  const tending = useTranslations('engagements.command.ending');
  const { confirm, dialog } = useConfirm();

  async function choose(): Promise<void> {
    const action = DIRECT_TRIGGER_ACTIONS.continueToExecution;
    if (!action) return;
    const confirmed = await confirm({
      title: t('confirmTitle'),
      description: t('confirmBody'),
      confirmLabel: t('cta'),
      cancelLabel: tending('cancel'),
    });
    if (!confirmed) return;
    runAction((idempotencyKey) => action(engagementId, idempotencyKey), 'continueToExecution');
  }

  return (
    <div className="mt-4 space-y-2.5">
      <p className="text-body text-[color:var(--text-muted)]">{t('note')}</p>
      <Button variant="secondary" type="button" disabled={pending} onClick={() => void choose()}>
        {t('cta')}
      </Button>
      {dialog}
    </div>
  );
}
