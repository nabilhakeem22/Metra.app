'use client';

import { Copy, Link2, Loader2, RefreshCw, Share2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import {
  revokeDeliveryLink,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';

/**
 * Cockpit "Share with client" control. Owner/admin only (the caller passes
 * `canShare`). Mints ONE durable per-delivery link, reveals the raw URL ONCE (it
 * is unrecoverable after — offer Rotate for a fresh one), and can Revoke it. The
 * raw token never round-trips again; only the sha256 hash is stored server-side.
 */
export function DeliveryShareLink({
  engagementId,
  initialShared,
  canShare,
}: {
  engagementId: string;
  initialShared: boolean;
  canShare: boolean;
}) {
  const t = useTranslations('delivery.share');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shared, setShared] = useState(initialShared);
  // The raw link, revealed ONCE right after mint/rotate. Cleared on revoke.
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canShare) return null;

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; link?: string }>,
    onOk: (link?: string) => void,
  ) {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk(res.link);
        router.refresh();
      } else {
        setError(res.error ?? 'generic');
      }
    });
  }

  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link);
    setCopied(true);
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <Share2 className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">{t('title')}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {shared ? t('sharedHint') : t('notSharedHint')}
        </p>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {t('error')}
          </p>
        )}

        {link && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
              <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <code className="flex-1 truncate text-xs" dir="ltr">
                {link}
              </code>
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy className="size-3.5" aria-hidden />
                {copied ? t('copied') : t('copyLink')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('revealOnce')}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!shared && !link && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => shareDeliveryLink(engagementId),
                  (l) => {
                    setShared(true);
                    setLink(l ?? null);
                  },
                )
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Share2 className="size-4" aria-hidden />
              )}
              {t('shareCta')}
            </Button>
          )}

          {shared && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => rotateDeliveryLink(engagementId),
                    (l) => setLink(l ?? null),
                  )
                }
              >
                <RefreshCw className="size-4" aria-hidden />
                {t('rotate')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={pending}
                onClick={() =>
                  run(
                    () => revokeDeliveryLink(engagementId),
                    () => {
                      setShared(false);
                      setLink(null);
                    },
                  )
                }
              >
                <X className="size-4" aria-hidden />
                {t('revoke')}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
