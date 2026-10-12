import type { ReactNode } from 'react';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';

// The client's variation link: its client components get only the `variationLink` messages
// (src/i18n/client-namespaces.ts), not the whole catalogue.
export default function VariationLinkLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="variationLink">{children}</ScopedIntlProvider>;
}
