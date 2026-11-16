import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isLocale } from '@/i18n/routing';
import { linkDocumentRead } from '@/lib/client-home/optional-read';
import { variationLinkLanding } from '@/lib/client-home/redirect-variation';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { getVariationByToken } from '@/lib/variations/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { DeliveryNotice } from '../../d/[token]/portal/delivery-notice';
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
// The order's own read is bounded and caught: one that failed or stalled says
// nothing about the link, so it renders the client home's "refresh" notice,
// never Next's raw error screen; a null answer stays the invalid-link page.
export default async function PublicVariationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const read = await linkDocumentRead('public variation read failed:', getVariationByToken(token));
  if (!read) return <DeliveryNotice notice="readFailed" switchHref={`/v/${tokenPathSegment(token)}`} locale={locale} />;
  const { homePath, waitsForSignature } = await variationLinkLanding(token, read.document, locale);
  if (homePath) redirect(homePath);
  return <PublicVariationView token={token} variation={read.document} waitsForSignature={waitsForSignature} />;
}
