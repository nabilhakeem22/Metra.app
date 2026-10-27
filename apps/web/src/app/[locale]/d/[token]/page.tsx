import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { homeNamesSource } from '@/lib/client-home/names';
import { homeHref, requestedFocus, requestedTab } from '@/lib/client-home/tab';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { deliveryMetadata, type DeliveryTranslator, type NamedRead } from './delivery-metadata';
import { ExecutionTabView } from './execution-tab';
import { readHomeView } from './home-read';
import { PublicDeliveryView } from './public-delivery';

/** One read of the chosen tab per request, shared by the metadata and the page. */
const readView = cache(readHomeView);

type PageSearch = Promise<Record<string, string | string[] | undefined>>;

/**
 * The view of the tab the URL asks for. A link to a tab the delivery does not
 * have (a light delivery's design tab) is sent to the tab it does have. The
 * route's loading skeleton has streamed by then, so Next redirects in the page
 * (its router, with a refresh tag for no script) rather than with a 307, and
 * never with a cached 308.
 */
async function renderedView(locale: string, token: string, tab: string | string[] | undefined) {
  const view = await readView(token, requestedTab(tab));
  if (view.tab === 'redirect') redirect(`/${locale}${homeHref(tokenPathSegment(token), view.to)}`);
  return view;
}

// Durable client share link — private to the recipient. Never indexed, and titled
// in the client's own words (./delivery-metadata.ts).
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: PageSearch;
}): Promise<Metadata> {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: 'delivery' });
  const view = await renderedView(locale, token, (await searchParams).tab);
  const named: NamedRead = view.tab === 'execution' ? { status: 'ok', delivery: homeNamesSource(view.home) } : view.read;
  return deliveryMetadata(named, view.tab, locale, t as unknown as DeliveryTranslator);
}

// The client's ONE page, the delivery link: NO session, NO (app) shell/nav, never
// redirects to /login. Lives outside the (app) group so the auth layout never
// runs. The token IS the auth; an unknown / revoked / expired token renders the
// friendly not-found page, and a read that FAILED renders a different,
// transient notice — a valid link during a database blip must not be called dead.
// `?tab=` picks the Design or the Execution tab (./home-read.ts reads only that
// tab's data); `?focus=` opens the home on one section, or on one payment's
// "I've made this payment" with its code box (the link a code email carries).
export default async function PublicDeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: PageSearch;
}) {
  const { locale, token } = await params;
  // The download route bounces every failure back here with ?document=unavailable —
  // one flag, no detail, so the notice can never tell the client (or a prober)
  // WHICH failure occurred.
  const { document, tab, focus } = await searchParams;
  const view = await renderedView(locale, token, tab);
  if (view.tab === 'execution') {
    return <ExecutionTabView token={token} home={view.home} focus={requestedFocus(focus)} />;
  }
  return (
    <PublicDeliveryView token={token} read={view.read} documentUnavailable={document === 'unavailable'} focus={requestedFocus(focus)} />
  );
}
