import type { ReactNode } from 'react';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';

// A team invitation: its client components get only the `invite` messages
// (src/i18n/client-namespaces.ts), not the whole catalogue.
export default function InviteLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="invite">{children}</ScopedIntlProvider>;
}
