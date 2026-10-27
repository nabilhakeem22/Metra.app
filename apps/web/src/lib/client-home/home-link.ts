import 'server-only';
// The contract's client home as the studio is handed it, in one place, so the
// contract page's "Client page" control and the contract's issue (H6.4) build
// the same link.
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { deliveryPortalUrl, requestLocaleOrDefault } from '@/lib/engagements/portal-url';
import { ensureClientHomeCore } from './ensure';
import type { ClientHomeAnswer } from './types';

/**
 * The client home of one BOQ contract (ensureClientHomeCore: found, or a light
 * delivery created): its Execution tab's absolute URL in the studio user's
 * locale (`${origin}/<locale>/d/<token>?tab=execution`), why it cannot be
 * shown, or the refusal.
 */
export async function clientHomeAnswer(ctx: OrgContext, contractId: string, origin: string): Promise<ClientHomeAnswer> {
  const res = await ensureClientHomeCore(ctx, { contractId });
  if (!res.ok) return { ...res, ok: false };
  if (!res.data) return unexpectedFailure('ensureClientHomeCore answered ok without a home');
  const home = res.data;
  if (home.link === null) return { ok: true, link: null, linkReason: home.linkReason };
  return { ok: true, link: `${deliveryPortalUrl(origin, await requestLocaleOrDefault(), home.link)}?tab=execution` };
}
