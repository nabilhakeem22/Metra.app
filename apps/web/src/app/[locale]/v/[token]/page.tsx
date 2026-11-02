import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isLocale } from '@/i18n/routing';
import { variationLinkLanding } from '@/lib/client-home/redirect-variation';
import { getVariationByToken } from '@/lib/variations/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicVariationView } from './public-variation';

// Tokenized share link — single-use, private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

// Public share page: NO session, NO (app) shell/nav, never redirects to /login.
//
// The link of a BOQ contract's change order awaiting the client's decision opens
// the client home, where it is decided with a code (H7.2); every other link
// renders its own document. A locale this app does not have reads nothing, so no
// home link is ever built for one. A 307 (redirect, replace), never a cached
// 308, as a rotated home link must not be remembered. Never inside a try/catch:
// redirect throws NEXT_REDIRECT.
// WHY this segment has no loading.tsx: a skeleton streams before the page
// runs, after which Next can only redirect in the browser (a 200 with a
// refresh tag). A gate in a layout does not help either: Next renders a
// segment's layout and page in parallel, so the page's whole change order would
// ride in the 307's body.
export default async function PublicVariationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const variation = await getVariationByToken(token);
  const { homePath, waitsForSignature } = await variationLinkLanding(token, variation, locale);
  if (homePath) redirect(homePath);
  return <PublicVariationView token={token} variation={variation} waitsForSignature={waitsForSignature} />;
}
