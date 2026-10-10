// The names a client page shows, in the page's language. PURE and CLIENT-SAFE:
// the page body and the page's <title> read the same rule.
import { cairoYear, formatDocNumber } from '@/lib/format/doc-number';
import type { PublicDelivery } from './types';

export interface DeliveryDisplayNames {
  /** The studio's name, or "Metra" when the studio set none. */
  firmName: string;
  /** The project title, or '' when there is none. */
  title: string;
  /** The client's name, or '' when it is unknown. */
  clientName: string;
}

/** Arabic first on an Arabic page and English first otherwise, each falling back to the other. */
export function deliveryDisplayNames(
  delivery: Pick<PublicDelivery, 'firm' | 'client' | 'titleAr' | 'titleEn'>,
  locale: string,
): DeliveryDisplayNames {
  const wantArabic = locale.startsWith('ar');
  const pick = (arabic: string | null, english: string | null) =>
    (wantArabic ? arabic || english : english || arabic) ?? '';
  return {
    firmName: pick(delivery.firm.nameAr, delivery.firm.nameEn) || 'Metra',
    title: pick(delivery.titleAr, delivery.titleEn),
    clientName: pick(delivery.client.nameAr, delivery.client.nameEn),
  };
}

/**
 * The delivery's reference as the studio files it, DE-YYYY-NNNN (the Cairo
 * year of its creation, as on every studio surface), or '' when the number or
 * the creation date is unusable. The only thing of the delivery a WhatsApp
 * message to the studio names.
 */
export function deliveryReference(delivery: Pick<PublicDelivery, 'number' | 'createdAt'>): string {
  const year = delivery.createdAt ? cairoYear(delivery.createdAt) : Number.NaN;
  return delivery.number > 0 && Number.isFinite(year) ? formatDocNumber('DE', delivery.number, year) : '';
}
