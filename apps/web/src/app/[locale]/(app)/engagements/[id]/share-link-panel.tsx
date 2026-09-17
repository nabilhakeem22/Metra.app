'use client';

import { Copy, Link2, Loader2, RefreshCw, Share2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { DeliveryShareApi } from './use-delivery-share';

/** The revealed link, its copy button, and the once-only warning under it. */
function RevealedLink({ share }: { share: DeliveryShareApi }) {
  const t = useTranslations('delivery.share');
  if (!share.link) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <code className="flex-1 truncate text-xs" dir="ltr">
          {share.link}
        </code>
        <Button size="sm" variant="outline" onClick={share.copy}>
          <Copy className="size-3.5" aria-hidden />
          {share.copied ? t('copied') : t('copyLink')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('revealOnce')}</p>
    </div>
  );
}

/** Share, or rotate + revoke. Never both sets: a link either exists or does not. */
function ShareActions({ share }: { share: DeliveryShareApi }) {
  const t = useTranslations('delivery.share');
  const spinner = share.pending ? (
    <Loader2 className="size-4 animate-spin" aria-hidden />
  ) : null;
  return (
    <div className="flex flex-wrap gap-2">
      {!share.shared && !share.link && (
        <Button size="sm" disabled={share.pending} onClick={share.share}>
          {spinner ?? <Share2 className="size-4" aria-hidden />}
          {t('shareCta')}
        </Button>
      )}

      {share.shared && (
        <>
          <Button size="sm" variant="outline" disabled={share.pending} onClick={share.rotate}>
            {spinner ?? <RefreshCw className="size-4" aria-hidden />}
            {t('rotate')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={share.pending}
            onClick={share.revoke}
          >
            <X className="size-4" aria-hidden />
            {t('revoke')}
          </Button>
        </>
      )}
    </div>
  );
}

/** Everything the disclosure reveals when it is open. */
export function ShareLinkPanel({ share }: { share: DeliveryShareApi }) {
  const t = useTranslations('delivery.share');
  return (
    <div className="space-y-3 px-4 pb-4">
      <p className="text-sm text-muted-foreground">
        {share.shared ? t('sharedHint') : t('notSharedHint')}
      </p>

      {share.error && (
        <p className="text-sm text-destructive" role="alert">
          {t('error')}
        </p>
      )}

      <RevealedLink share={share} />
      <ShareActions share={share} />

      {share.shared && <p className="text-xs text-muted-foreground">{t('rotateHint')}</p>}
    </div>
  );
}
