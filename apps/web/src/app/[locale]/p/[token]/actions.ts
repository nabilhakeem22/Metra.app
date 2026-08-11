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
  // S2: cap the audit fields before they reach the DB.
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
  const ua = h.get('user-agent')?.slice(0, 512) || null;
  const name = actorName?.trim().slice(0, 120) || null;
  return respondToProposalByToken(token, {
    decision,
    actorName: name,
    ip,
    userAgent: ua,
  });
}
