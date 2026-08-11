import { getProposalByToken } from '@/lib/proposals/public';
import { PublicProposalView } from './public-proposal';

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
