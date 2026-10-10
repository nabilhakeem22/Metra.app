'use client';

import { MessageCircle, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { whatsappUrl } from '@/lib/engagements/reminder/whatsapp';

const BUTTON_CLASS =
  'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-pill border bg-background text-foreground outline-none focus-ring-brand hover:bg-muted';

/**
 * The studio's WhatsApp and Call buttons on the client page's bar, each shown
 * only when the studio set a usable number (normalised server-side: B11's
 * WhatsApp digits, the CHECKed phone). The WhatsApp message names only the
 * delivery's reference (DE-YYYY-NNNN), never the client's name or anything else
 * of theirs. 44 x 44 px, icon-only with an accessible name.
 */
export function StudioContact({
  phone,
  whatsappDigits,
  deliveryRef,
}: {
  phone: string | null;
  whatsappDigits: string | null;
  deliveryRef: string;
}) {
  const t = useTranslations('delivery.studioBar');
  return (
    <>
      {whatsappDigits && (
        <a
          href={whatsappUrl(whatsappDigits, t('whatsappText', { ref: deliveryRef }))}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('whatsapp')}
          title={t('whatsapp')}
          className={BUTTON_CLASS}
        >
          <MessageCircle className="size-5" aria-hidden />
        </a>
      )}
      {phone && (
        <a href={`tel:${phone}`} aria-label={t('call')} title={t('call')} className={BUTTON_CLASS}>
          <Phone className="size-5" aria-hidden />
        </a>
      )}
    </>
  );
}
