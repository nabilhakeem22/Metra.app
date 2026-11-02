'use client';

import { Eye, Loader2, RefreshCw, Share2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import type { DeliveryShareApi } from './use-delivery-share';

/**
 * Share, or (once shared) Show link plus the link's menu (replace, revoke).
 * Show link re-derives the link the client already holds and changes nothing.
 * Both menu actions ask first: each one stops the link the client holds from
 * working, and neither can be taken back.
 */
export function ShareActions({ share }: { share: DeliveryShareApi }) {
  const t = useTranslations('delivery.share');
  const tc = useTranslations('common');
  const { confirm, dialog } = useConfirm();

  async function confirmThen(
    copy: { title: string; body: string; confirm: string },
    act: () => void,
  ): Promise<void> {
    const confirmed = await confirm({
      title: copy.title,
      description: `${copy.body} ${tc('cannotUndo')}`,
      confirmLabel: copy.confirm,
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (confirmed) act();
  }

  if (!share.shared) {
    if (share.link) return null;
    return (
      <Button variant="secondary" size="sm" disabled={share.pending} onClick={share.share}>
        {share.pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Share2 className="size-4" aria-hidden />
        )}
        {t('shareCta')}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {dialog}
      {!share.link && (
        <Button variant="secondary" size="sm" disabled={share.pending} onClick={share.reveal}>
          <Eye className="size-4" aria-hidden />
          {t('showLink')}
        </Button>
      )}
      {share.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      <OverflowMenu
        label={t('moreActions')}
        disabled={share.pending}
        actions={[
          {
            key: 'rotate',
            label: t('rotate'),
            icon: RefreshCw,
            onSelect: () =>
              void confirmThen(
                {
                  title: t('confirmRotate.title'),
                  body: t('confirmRotate.body'),
                  confirm: t('rotate'),
                },
                share.rotate,
              ),
          },
          {
            key: 'revoke',
            label: t('revoke'),
            icon: X,
            destructive: true,
            onSelect: () =>
              void confirmThen(
                {
                  title: t('confirmRevoke.title'),
                  body: t('confirmRevoke.body'),
                  confirm: t('confirmRevoke.confirm'),
                },
                share.revoke,
              ),
          },
        ]}
      />
    </div>
  );
}
