import type { ReactNode } from 'react';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';

// The client's contract link: its client components get only the `contractLink` messages
// (src/i18n/client-namespaces.ts), not the whole catalogue.
export default function ContractLinkLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="contractLink">{children}</ScopedIntlProvider>;
}
