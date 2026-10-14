'use server';

import { headers } from 'next/headers';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
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
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
    const ua = h.get('user-agent')?.slice(0, 512) || null;
    // Directly invokable: a non-string name is no name, never a throw.
    const name = (typeof actorName === 'string' ? actorName.trim().slice(0, 120) : '') || null;
    return respondToVariationByToken(token, { decision, actorName: name, ip, userAgent: ua });
  });
}
