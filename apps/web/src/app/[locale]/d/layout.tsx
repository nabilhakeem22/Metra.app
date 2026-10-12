import type { ReactNode } from 'react';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';

// The client's delivery page: its client components get only the `deliveryLink` messages
// (src/i18n/client-namespaces.ts), not the whole catalogue.
export default function DeliveryLinkLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="deliveryLink">{children}</ScopedIntlProvider>;
}
