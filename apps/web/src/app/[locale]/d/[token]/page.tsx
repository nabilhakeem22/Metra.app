import type { Metadata } from 'next';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicDeliveryView } from './public-delivery';

// Durable client share link — private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

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
  const read = await getDeliveryByToken(token);
  return (
    <PublicDeliveryView
      token={token}
      read={read}
      documentUnavailable={document === 'unavailable'}
    />
  );
}
