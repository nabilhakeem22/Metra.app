// The names a client page shows, in the page's language. PURE and CLIENT-SAFE:
// the page body and the page's <title> read the same rule.
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
