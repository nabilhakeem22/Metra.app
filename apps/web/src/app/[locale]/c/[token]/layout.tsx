import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { contractHomeRedirect } from '@/lib/client-home/redirect';

// An old contract link (/c) of a BOQ contract opens the client home, where the
// contract is signed with a code (H6.3); every other link renders /c as before.
//
// WHY A LAYOUT, not the page: this segment's loading.tsx streams the skeleton
// before the page runs, and after the first byte Next can only redirect in the
// browser (a 200 with a refresh tag). A layout runs OUTSIDE its own segment's
// loading boundary, so its redirect is a real 307 and the page never renders.
// A 307 (redirect), never a cached 308: a rotated home link must not be
// remembered. Never inside a try/catch: redirect throws NEXT_REDIRECT. The
// parent [locale] layout has already refused an unknown locale.
export default async function ContractTokenLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; token: string }>;
}): Promise<ReactNode> {
  const { locale, token } = await params;
  const home = await contractHomeRedirect(token, locale);
  if (home) redirect(home);
  return children;
}
