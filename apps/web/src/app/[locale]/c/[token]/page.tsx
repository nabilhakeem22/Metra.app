import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isLocale } from '@/i18n/routing';
import { contractHomeRedirect } from '@/lib/client-home/redirect';
import { getContractByToken } from '@/lib/contracts/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicContractView } from './public-contract';

// Tokenized share link — single-use, private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

// Public share page: NO session, NO (app) shell/nav, never redirects to /login.
// Lives outside the (app) group so the auth layout never runs.
//
// The link of a BOQ contract awaiting its signature opens the client home, where
// it is signed with a code (H6.3); every other link renders its own document.
// A locale this app does not have reads nothing, so no home link is ever built
// for one. A 307 (redirect, replace), never a cached 308, as a rotated home link
// must not be remembered. Never inside a try/catch: redirect throws NEXT_REDIRECT.
// WHY this segment has no loading.tsx: a skeleton streams before the page
// runs, after which Next can only redirect in the browser (a 200 with a
// refresh tag). A gate in a layout does not help either: Next renders a
// segment's layout and page in parallel, so the page's whole contract would
// ride in the 307's body.
export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const contract = await getContractByToken(token);
  const home = await contractHomeRedirect(token, contract, locale);
  if (home) redirect(home);
  return <PublicContractView token={token} contract={contract} />;
}
