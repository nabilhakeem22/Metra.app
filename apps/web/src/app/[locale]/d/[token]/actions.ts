'use server';

import { headers } from 'next/headers';
import {
  recordDeliveryActionByToken,
  type DeliveryActionResult,
} from '@/lib/engagements/public';

/**
 * Public (no-session) client delivery-portal action. Captures the client IP +
 * user agent from the request headers for the append-only engagement_events audit
 * trail (mirrors the proposal p/[token] action). The raw token flows straight to
 * recordDeliveryActionByToken, which hashes it — it is NEVER logged here. The
 * signal is advisory: it moves no state and adds no blocking guard.
 */
export async function recordDeliveryAction(
  token: string,
  action: string,
  note?: string,
): Promise<DeliveryActionResult> {
  const h = await headers();
  // Cap the audit fields before they reach the DB (the SDF also caps note at 2000).
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
  const ua = h.get('user-agent')?.slice(0, 512) || null;
  const trimmedNote = note?.trim().slice(0, 2000) || null;
  return recordDeliveryActionByToken(token, {
    action,
    note: trimmedNote,
    ip,
    userAgent: ua,
  });
}
