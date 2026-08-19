'use server';

import { headers } from 'next/headers';
import {
  respondToVariationByToken,
  type RespondError,
} from '@/lib/variations/public';

/**
 * Public (no-session) variation approve/reject. Captures the client IP + user
 * agent from the request headers for the variation_order_events audit trail.
 */
export async function respondToVariation(
  token: string,
  decision: 'approve' | 'reject',
  actorName?: string,
): Promise<{ ok: boolean; error?: RespondError }> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
  const ua = h.get('user-agent')?.slice(0, 512) || null;
  const name = actorName?.trim().slice(0, 120) || null;
  return respondToVariationByToken(token, {
    decision,
    actorName: name,
    ip,
    userAgent: ua,
  });
}
