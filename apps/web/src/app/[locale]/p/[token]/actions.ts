'use server';

import { respondToProposalByToken, type RespondError } from '@/lib/proposals/public';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { requestProvenance } from '@/lib/share/request-provenance';

/** The client's answer: the decision's outcome, or an act that never landed. */
export type ProposalAnswer = { ok: boolean; error?: RespondError } | ({ ok: false } & PortalFailure);

/**
 * Public (no-session) accept/reject. Captures the client IP + user agent
 * (requestProvenance) for the proposal_events audit trail. Nothing throws to
 * the client: a failure underneath answers `uncertain` or `generic` with a
 * reference (answered), and the page keeps the decision open.
 */
export async function respondToProposal(
  token: string,
  decision: 'accept' | 'reject',
  actorName?: string,
): Promise<ProposalAnswer> {
  return answered('respondToProposal', (failure) => ({ ok: false as const, ...failure }), async () => {
    // The edge-trusted client IP (cf-connecting-ip), capped, for the audit trail.
    const { ip, userAgent } = await requestProvenance();
    // Directly invokable: a non-string name is no name, never a throw.
    const name = (typeof actorName === 'string' ? actorName.trim().slice(0, 120) : '') || null;
    return respondToProposalByToken(token, { decision, actorName: name, ip, userAgent });
  });
}
