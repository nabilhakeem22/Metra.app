import type { Metadata } from 'next';
import { getProposalByToken } from '@/lib/proposals/public';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { PublicProposalView } from './public-proposal';

// Tokenized share link — single-use, private to the recipient. Never index it.
export const metadata: Metadata = PRIVATE_METADATA;

// Public share page: NO session, NO (app) shell/nav, never redirects to /login.
// Lives outside the (app) group so the auth layout never runs.
export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const proposal = await getProposalByToken(token);
  return <PublicProposalView token={token} proposal={proposal} />;
}
