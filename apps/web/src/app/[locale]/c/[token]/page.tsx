import type { Metadata } from 'next';
import { getContractByToken } from '@/lib/contracts/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicContractView } from './public-contract';

// Tokenized share link — single-use, private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

// Public share page: NO session, NO (app) shell/nav, never redirects to /login.
// Lives outside the (app) group so the auth layout never runs.
export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const contract = await getContractByToken(token);
  return <PublicContractView token={token} contract={contract} />;
}
