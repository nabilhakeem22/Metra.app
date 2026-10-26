// The client home's names in the shape the delivery page's names are read from
// (lib/engagements/public/display-names.ts), so the Execution tab, the design
// tab and the page title all say the studio, the client and the project the
// same way. PURE and CLIENT-SAFE.
import type { DeliveryNamesSource } from '@/lib/engagements/public/display-names';
import type { PortalHome } from './types';

export function homeNamesSource(home: PortalHome): DeliveryNamesSource {
  return { firm: home.firm, client: home.client, titleAr: home.delivery.titleAr, titleEn: home.delivery.titleEn };
}
