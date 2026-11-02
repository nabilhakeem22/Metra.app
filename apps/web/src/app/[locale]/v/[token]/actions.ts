'use server';

import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { requestProvenance } from '@/lib/share/request-provenance';
import { respondToVariationByToken, type RespondError } from '@/lib/variations/public';

/** The client's answer: the decision's outcome, or an act that never landed. */
export type VariationAnswer = { ok: boolean; error?: RespondError } | ({ ok: false } & PortalFailure);

/**
 * Public (no-session) variation approve/reject. Captures the client IP + user
 * agent from the request headers for the variation_order_events audit trail.
 * Nothing throws to the client: a failure underneath answers `uncertain` or
 * `generic` with a reference (answered), and the page keeps the decision open.
 */
export async function respondToVariation(
  token: string,
  decision: 'approve' | 'reject',
  actorName?: string,
): Promise<VariationAnswer> {
  return answered('respondToVariation', (failure) => ({ ok: false as const, ...failure }), async () => {
    // The edge-trusted client IP (cf-connecting-ip), capped, for the audit trail.
    const { ip, userAgent } = await requestProvenance();
    // Directly invokable: a non-string name is no name, never a throw.
    const name = (typeof actorName === 'string' ? actorName.trim().slice(0, 120) : '') || null;
    return respondToVariationByToken(token, { decision, actorName: name, ip, userAgent });
  });
}
