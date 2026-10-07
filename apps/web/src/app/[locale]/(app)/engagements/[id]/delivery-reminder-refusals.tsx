'use client';

import { Loader2, RefreshCw, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { DeliveryReminderApi } from './use-delivery-reminder';

/** A refusal's title, its explanation, and (when there is one) its way out. */
function Refusal({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-body font-semibold">{title}</p>
      <p className="text-small text-[color:var(--text-muted)]">{body}</p>
      {children}
    </div>
  );
}

/** No live link (never shared, or revoked): the way out is to share one. */
export function ReminderNotShared({ api }: { api: DeliveryReminderApi }) {
  const t = useTranslations('engagements.reminder');
  return (
    <Refusal title={t('notSharedTitle')} body={t('notSharedBody')}>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={api.changingLink}
        onClick={api.shareAndReload}
      >
        {api.changingLink ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Share2 className="size-4" aria-hidden />
        )}
        {t('share')}
      </Button>
    </Refusal>
  );
}

/**
 * The server cannot re-create links at all (SHARE_LINK_SECRET missing or too
 * short). No Replace: it would kill the client's working link and the new one
 * would not be resendable either.
 */
export function ReminderNotConfigured() {
  const t = useTranslations('engagements.reminder');
  return <Refusal title={t('notConfiguredTitle')} body={t('notConfiguredBody')} />;
}

/** A live link that cannot be re-created: explain why, and offer ONE replacement, behind a confirm. */
export function ReminderReplaceLink({ api }: { api: DeliveryReminderApi }) {
  const t = useTranslations('engagements.reminder');
  const tc = useTranslations('common');
  const { confirm, dialog } = useConfirm();

  async function confirmReplace(): Promise<void> {
    const confirmed = await confirm({
      title: t('confirmReplace.title'),
      description: `${t('confirmReplace.body')} ${tc('cannotUndo')}`,
      confirmLabel: t('replace'),
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (confirmed) api.replaceAndReload();
  }

  return (
    <Refusal title={t('unrecoverableTitle')} body={t('unrecoverableBody')}>
      {dialog}
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={api.changingLink}
        onClick={() => void confirmReplace()}
      >
        {api.changingLink ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        {t('replace')}
      </Button>
    </Refusal>
  );
}
