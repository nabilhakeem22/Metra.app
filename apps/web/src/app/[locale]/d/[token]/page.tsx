import type { Metadata } from 'next';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicDeliveryView } from './public-delivery';

// Durable client share link — private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

// Public client delivery portal: NO session, NO (app) shell/nav, never redirects
// to /login. Lives outside the (app) group so the auth layout never runs. The
// token IS the auth; an unknown / revoked / expired token resolves to null and
// renders the friendly not-found page.
export default async function PublicDeliveryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const delivery = await getDeliveryByToken(token);
  return <PublicDeliveryView token={token} delivery={delivery} />;
}
