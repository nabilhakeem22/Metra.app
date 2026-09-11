'use client';

import {
  ChevronDown,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import {
  revokeDeliveryLink,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';
import {
  DELIVERY_SHARE_ANCHOR_ID,
  DELIVERY_SHARE_OPEN_EVENT,
} from './share-anchor';

/**
 * Cockpit "Share with client" control. Owner/admin only (the caller passes
 * `canShare`).
 *
 * COLLAPSED BY DEFAULT. Sharing is a side action that sat between the header and
 * the command card, pushing the thing the studio came here to do down the page.
 * Closed, it is one row that still says where the delivery stands — "Link
 * active" or "Not shared yet" — so nothing is hidden, only folded.
 *
 * It OPENS BY ITSELF whenever there is something to read: right after a mint or
 * a reveal, on a refusal, and when the command card asks for it. A freshly
 * revealed token inside a closed box would be the one state where folding
 * actually costs the studio something.
 *
 * THE RAW TOKEN IS SHOWN ONCE AND IS THEN UNRECOVERABLE. Only its sha256 hash is
 * persisted (share.ts) — for this portal the token IS the client's
 * authentication, so keeping the plaintext would mean a database read, a backup,
 * or a leaked dump hands someone the client's delivery. That is why the answer
 * to "show me the link again" has to be a NEW link rather than the old one, and
 * why the button now says exactly that.
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
  const [open, setOpen] = useState(false);

  // The command card's "reveal the client link" scrolls here and asks to open.
  useEffect(() => {
    const el = document.getElementById(DELIVERY_SHARE_ANCHOR_ID);
    if (!el) return;
    const onOpen = () => setOpen(true);
    el.addEventListener(DELIVERY_SHARE_OPEN_EVENT, onOpen);
    return () => el.removeEventListener(DELIVERY_SHARE_OPEN_EVENT, onOpen);
  }, []);

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
        // A refusal belongs on screen, not folded away behind a closed row.
        setOpen(true);
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
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-3 text-start"
        >
          <Share2 className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <span
            className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
            style={
              shared
                ? { background: 'var(--success-tint)', color: 'var(--success)' }
                : { background: 'var(--track)', color: 'var(--text-muted)' }
            }
          >
            {shared ? t('statusActive') : t('statusNotShared')}
          </span>
          {/* A revealed link is the one thing you must not scroll past. */}
          {link && !open && (
            <span className="text-xs font-semibold text-[color:var(--warn)]">
              {t('unreadBadge')}
            </span>
          )}
          <ChevronDown
            className={`ms-auto size-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90 rtl:rotate-90'}`}
            aria-hidden
          />
        </button>

        {open && (
          <div className="space-y-3 px-4 pb-4">
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
                  <Link2
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
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
                        setOpen(true);
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
                        (l) => {
                          setLink(l ?? null);
                          setOpen(true);
                        },
                      )
                    }
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-4" aria-hidden />
                    )}
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

            {shared && (
              <p className="text-xs text-muted-foreground">{t('rotateHint')}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
