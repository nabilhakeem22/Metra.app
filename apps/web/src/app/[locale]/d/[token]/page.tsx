import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { executionCardForPage } from '@/lib/engagements/public/execution';
import { deliveryMetadata, type DeliveryTranslator } from './delivery-metadata';
import { PublicDeliveryView } from './public-delivery';

/** One read of the delivery per request, shared by the metadata and the page. */
const readDelivery = cache(getDeliveryByToken);

// Durable client share link — private to the recipient. Never indexed, and titled
// in the client's own words (./delivery-metadata.ts).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: 'delivery' });
  return deliveryMetadata(await readDelivery(token), locale, t as unknown as DeliveryTranslator);
}

// Public client delivery portal: NO session, NO (app) shell/nav, never redirects
// to /login. Lives outside the (app) group so the auth layout never runs. The
// token IS the auth; an unknown / revoked / expired token renders the friendly
// not-found page, and a read that FAILED renders a different, transient notice —
// a valid link during a database blip must not be called dead.
export default async function PublicDeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  // The download route bounces every failure back here with ?document=unavailable —
  // one flag, no detail, so the notice can never tell the client (or a prober)
  // WHICH failure occurred.
  const { document } = await searchParams;
  const read = await readDelivery(token);
  // The execution card (Stage 2, D1a) is a second, bounded read, made only for
  // a delivery at `execution` (its client word is `construction`), so no other
  // delivery page pays for it.
  const execution = read.status === 'ok' && read.delivery.stageKey === 'construction' ? await executionCardForPage(token) : null;
  return (
    <PublicDeliveryView
      token={token}
      read={read}
      execution={execution}
      documentUnavailable={document === 'unavailable'}
    />
  );
}
