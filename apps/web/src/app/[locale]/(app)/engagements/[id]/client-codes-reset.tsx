'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { describeShownFailure } from '@/lib/actions/error-message';
import { useClientCodesReset } from './use-client-codes-reset';

/**
 * "Reset the client's codes", in the client link dialog (owner and admin: the
 * dialog is theirs, and the server checks it again). For a client who cannot
 * get a one-time code today because the link's 10 codes of the day were used
 * up: after the reset every code already sent stops working and the client
 * can ask for a new one at once. It asks first; the reset is audited.
 * Egyptian copy (delivery.share.*: the studio's own control).
 */
export function ClientCodesReset({ engagementId }: { engagementId: string }) {
  const t = useTranslations('delivery.share.codes');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const { confirm, dialog } = useConfirm();
  const codes = useClientCodesReset(engagementId);

  async function askThenReset(): Promise<void> {
    const confirmed = await confirm({
      title: t('confirm.title'),
      description: t('confirm.body'),
      confirmLabel: t('reset'),
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (confirmed) codes.reset();
  }

  return (
    <section aria-labelledby="client-codes-reset-title" className="space-y-2 border-t px-4 pb-4 pt-3">
      {dialog}
      <h3 id="client-codes-reset-title" className="text-body font-semibold">
        {t('title')}
      </h3>
      <p className="text-caption text-muted-foreground">{t('hint')}</p>
      <Button variant="secondary" size="sm" disabled={codes.pending} onClick={() => void askThenReset()}>
        {codes.pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
        {t('reset')}
      </Button>
      {codes.outcome?.done && (
        <p role="status" className="text-caption text-foreground">
          {t('done')}
        </p>
      )}
      {codes.outcome && !codes.outcome.done && (
        <p role="alert" className="text-caption text-destructive">
          {describeShownFailure(codes.outcome.failure, te)}
        </p>
      )}
    </section>
  );
}
