import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';

// The (auth) OTP steps are an internal sign-in surface — never index them.
// Pass-through wrapper: no visual change, it only carries the noindex metadata.
export const metadata: Metadata = PRIVATE_METADATA;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
