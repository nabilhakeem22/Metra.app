'use server';

import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { requestProvenance } from '@/lib/share/request-provenance';
import { decidesInClientHome } from '@/lib/variations/home-deciding';
import { getVariationByToken, respondToVariationByToken, type RespondError } from '@/lib/variations/public';

/** The client's answer: the decision's outcome, or an act that never landed. */
export type VariationAnswer = { ok: boolean; error?: RespondError | 'moved' } | ({ ok: false } & PortalFailure);

/**
 * Public (no-session) variation approve/reject, for a proposal contract's order:
 * a BOQ contract's is decided in the client home with a code, so it answers
 * `moved` with nothing written (a direct call: its page has no buttons). Captures
 * the client IP + user agent from the request headers for the
 * variation_order_events audit trail. Nothing throws to the client: a failure
 * underneath answers `uncertain` or `generic` with a reference (answered), and
 * the page keeps the decision open.
 */
export async function respondToVariation(
  token: string,
  decision: 'approve' | 'reject',
  actorName?: string,
): Promise<VariationAnswer> {
  return answered('respondToVariation', (failure) => ({ ok: false as const, ...failure }), async () => {
    const variation = await getVariationByToken(token);
    if (variation !== null && decidesInClientHome(variation)) return { ok: false, error: 'moved' as const };
    // The edge-trusted client IP (cf-connecting-ip), capped, for the audit trail.
    const { ip, userAgent } = await requestProvenance();
    // Directly invokable: a non-string name is no name, never a throw.
    const name = (typeof actorName === 'string' ? actorName.trim().slice(0, 120) : '') || null;
    return respondToVariationByToken(token, { decision, actorName: name, ip, userAgent });
  });
}
