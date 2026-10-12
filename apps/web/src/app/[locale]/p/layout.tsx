import type { ReactNode } from 'react';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';

// The client's proposal link: its client components get only the `proposalLink` messages
// (src/i18n/client-namespaces.ts), not the whole catalogue.
export default function ProposalLinkLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="proposalLink">{children}</ScopedIntlProvider>;
}
