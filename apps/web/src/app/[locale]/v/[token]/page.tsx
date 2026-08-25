import type { Metadata } from 'next';
import { getVariationByToken } from '@/lib/variations/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicVariationView } from './public-variation';

// Tokenized share link — single-use, private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

// Public share page: NO session, NO (app) shell/nav, never redirects to /login.
export default async function PublicVariationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const variation = await getVariationByToken(token);
  return <PublicVariationView token={token} variation={variation} />;
}
