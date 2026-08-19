import { getVariationByToken } from '@/lib/variations/public';
import { PublicVariationView } from './public-variation';

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
