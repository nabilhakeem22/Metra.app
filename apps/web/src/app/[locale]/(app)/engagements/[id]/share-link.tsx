'use client';

import { ChevronDown, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ShareLinkPanel } from './share-link-panel';
import { useDeliveryShare } from './use-delivery-share';

const ACTIVE_PILL: CSSProperties = {
  background: 'var(--success-tint)',
  color: 'var(--success)',
};

const IDLE_PILL: CSSProperties = {
  background: 'var(--track)',
  color: 'var(--text-muted)',
};

/**
 * Cockpit "Share with client" control. Owner/admin only (the caller passes
 * `canShare`).
 *
 * COLLAPSED BY DEFAULT. Sharing is a side action that sat between the header and
 * the command card, pushing the thing the studio came here to do down the page.
 * Closed, it is one row that still says where the delivery stands — "Link active"
 * or "Not shared yet" — so nothing is hidden, only folded.
 *
 * It OPENS BY ITSELF whenever there is something to read: right after a mint or a
 * reveal, on a refusal, and when the command card asks for it (see
 * use-delivery-share.ts).
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
  const share = useDeliveryShare({ engagementId, initialShared });

  if (!canShare) return null;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => share.setOpen(!share.open)}
          aria-expanded={share.open}
          className="flex w-full items-center gap-2 px-4 py-3 text-start"
        >
          <Share2 className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <span
            className="rounded-pill px-2 py-0.5 text-[11px] font-semibold"
            style={share.shared ? ACTIVE_PILL : IDLE_PILL}
          >
            {share.shared ? t('statusActive') : t('statusNotShared')}
          </span>
          {/* A revealed link is the one thing you must not scroll past. */}
          {share.link && !share.open && (
            <span className="text-xs font-semibold text-[color:var(--warn)]">
              {t('unreadBadge')}
            </span>
          )}
          <ChevronDown
            className={`ms-auto size-4 shrink-0 text-muted-foreground transition-transform ${share.open ? '' : '-rotate-90 rtl:rotate-90'}`}
            aria-hidden
          />
        </button>

        {share.open && <ShareLinkPanel share={share} />}
      </CardContent>
    </Card>
  );
}
