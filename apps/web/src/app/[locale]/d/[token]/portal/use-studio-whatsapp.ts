'use client';

import { useTranslations } from 'next-intl';
import { whatsappUrl } from '@/lib/engagements/reminder/whatsapp';
import type { PhaseKey } from '@/lib/flow/types';

/** The studio as a client card needs it to point the client at the studio. */
export interface StudioContactFacts {
  name: string;
  whatsappDigits: string | null;
  /** DE-YYYY-NNNN, the only thing a WhatsApp message to the studio names. */
  deliveryRef: string;
}

/**
 * The studio's WhatsApp, its message prefilled in the words of the phase the
 * page shows (naming only the delivery's reference, DE-YYYY-NNNN), or null
 * when the studio set no usable number.
 */
export function useStudioWhatsappHref(whatsappDigits: string | null, deliveryRef: string, phase: PhaseKey): string | null {
  const t = useTranslations(`delivery.studioBar.${phase}`);
  return whatsappDigits ? whatsappUrl(whatsappDigits, t('whatsappText', { ref: deliveryRef })) : null;
}
