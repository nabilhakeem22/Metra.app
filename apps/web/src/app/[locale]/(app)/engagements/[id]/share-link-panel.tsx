'use client';

import { Copy, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { describeShownFailure, type ShownFailure } from '@/lib/actions/error-message';
import { ShareActions } from './share-link-actions';
import type { DeliveryShareApi } from './use-delivery-share';

/** The revealed link, its copy button, and what to do with it. */
function RevealedLink({ share }: { share: DeliveryShareApi }) {
  const t = useTranslations('delivery.share');
  if (!share.link) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-item border bg-background px-2 py-1.5">
        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <code className="flex-1 truncate text-caption" dir="ltr">
          {share.link}
        </code>
        <Button size="sm" variant="secondary" onClick={share.copy}>
          <Copy className="size-3.5" aria-hidden />
          {share.copied ? t('copied') : t('copyLink')}
        </Button>
      </div>
      <p className="text-caption text-muted-foreground">{t('copyHint')}</p>
    </div>
  );
}

/** The refusals this dialog explains in its own words; anything else is "try again". */
const SHARE_ERROR_KEY: Partial<Record<string, 'unrecoverable' | 'notConfigured'>> = {
  delivery_link_unrecoverable: 'unrecoverable',
  delivery_links_not_configured: 'notConfigured',
};

/** The two refusals with a way out of their own say it; anything else says its cause. */
function useShareErrorText(): (failure: ShownFailure) => string {
  const t = useTranslations('delivery.share');
  const te = useTranslations('errors');
  return (failure) => {
    const own = 'error' in failure && failure.error ? SHARE_ERROR_KEY[failure.error] : undefined;
    return own ? t(own) : describeShownFailure(failure, te);
  };
}

export function ShareLinkPanel({ share }: { share: DeliveryShareApi }) {
  const t = useTranslations('delivery.share');
  const errorText = useShareErrorText();
  return (
    <div className="space-y-3 px-4 pb-4">
      <p className="text-body text-muted-foreground">
        {share.shared ? t('sharedHint') : t('notSharedHint')}
      </p>

      {share.error && (
        <p className="text-body text-destructive" role="alert">
          {errorText(share.error)}
        </p>
      )}

      <RevealedLink share={share} />
      <ShareActions share={share} />

      {share.shared && <p className="text-caption text-muted-foreground">{t('rotateHint')}</p>}
    </div>
  );
}
