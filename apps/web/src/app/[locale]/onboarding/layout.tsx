import type { ReactNode } from 'react';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';

// Onboarding: its client components get only the `onboarding` messages
// (src/i18n/client-namespaces.ts), not the whole catalogue.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="onboarding">{children}</ScopedIntlProvider>;
}
