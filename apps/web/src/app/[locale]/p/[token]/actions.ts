'use server';

import { headers } from 'next/headers';
import {
  respondToProposalByToken,
  type RespondError,
} from '@/lib/proposals/public';

/**
 * Public (no-session) accept/reject. Captures the client IP + user agent from
 * the request headers for the proposal_events audit trail.
 */
export async function respondToProposal(
  token: string,
  decision: 'accept' | 'reject',
  actorName?: string,
): Promise<{ ok: boolean; error?: RespondError }> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const ua = h.get('user-agent') ?? null;
  return respondToProposalByToken(token, {
    decision,
    actorName: actorName?.trim() || null,
    ip,
    userAgent: ua,
  });
}
