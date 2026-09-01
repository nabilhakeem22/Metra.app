'use server';

import { headers } from 'next/headers';
import {
  addDeliveryCommentByToken,
  claimPaymentByToken,
  getDeliveryDocumentCommentsByToken,
  recordDeliveryActionByToken,
  type DeliveryActionResult,
  type DeliveryCommentResult,
  type PublicDocumentComment,
} from '@/lib/engagements/public';

/**
 * The client IP for the advisory audit trail, capped at 45 chars. Prefers the
 * platform-trusted edge header `cf-connecting-ip` (set by Cloudflare, not
 * client-spoofable) and falls back to the FIRST `x-forwarded-for` hop only when the
 * edge header is absent. Advisory provenance only — never an authorization input.
 */
function clientIp(h: Headers): string | null {
  const edge = h.get('cf-connecting-ip')?.trim();
  if (edge) return edge.slice(0, 45);
  return h.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 45) || null;
}

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
  const ip = clientIp(h);
  const ua = h.get('user-agent')?.slice(0, 512) || null;
  const trimmedNote = note?.trim().slice(0, 2000) || null;
  return recordDeliveryActionByToken(token, {
    action,
    note: trimmedNote,
    ip,
    userAgent: ua,
  });
}

/**
 * Public (no-session) client delivery-portal action (Phase 3): the client "mark as
 * paid" on ONE milestone. Captures the client IP + user agent from the request
 * headers (capped 45/512) for the claim's provenance; the raw token is NEVER logged
 * here — it flows straight to claimPaymentByToken, which hashes it. The claim is a
 * PENDING record: it moves no state and writes no money ledger (the studio confirms
 * it later). The amount is locked server-side to the milestone's remaining due —
 * this action deliberately carries no amount input.
 */
export async function markDeliveryPaymentPaid(
  token: string,
  milestoneKind: string,
  note?: string,
): Promise<DeliveryActionResult> {
  const h = await headers();
  const ip = clientIp(h);
  const ua = h.get('user-agent')?.slice(0, 512) || null;
  const trimmedNote = note?.trim().slice(0, 2000) || null;
  return claimPaymentByToken(token, {
    milestoneKind,
    note: trimmedNote,
    ip,
    userAgent: ua,
  });
}

/**
 * Public (no-session) client delivery-portal action (Client Deliverables Step 2):
 * APPEND one client message to ONE released document's thread. Captures the client
 * IP + user agent (capped 45/512) for the append-only row's provenance, exactly like
 * the two actions above; the raw token is NEVER logged here — it flows straight to
 * addDeliveryCommentByToken, which hashes it.
 *
 * The message is ADVISORY: it moves no state and opens no change order. The client
 * still approves or requests changes with the stage buttons — this only lets them
 * say WHICH drawing and WHAT about it.
 */
export async function addDeliveryComment(
  token: string,
  documentId: string,
  body: string,
): Promise<DeliveryCommentResult> {
  const h = await headers();
  // Cap before the DB (the SDF also trims + caps at 2000 and CHECKs the length).
  const trimmed = body?.trim().slice(0, 2000) ?? '';
  if (!trimmed) return { ok: false, error: 'empty' };
  return addDeliveryCommentByToken(token, {
    documentId,
    body: trimmed,
    ip: clientIp(h),
    userAgent: h.get('user-agent')?.slice(0, 512) || null,
  });
}

/**
 * Public (no-session) read of ONE released document's thread, called when the client
 * OPENS that document's comments (never on the portal's first paint), so an unopened
 * portal carries no message bodies at all. Every failure returns the same empty
 * array — the caller cannot tell a forged id from an empty thread.
 */
export async function loadDeliveryDocumentComments(
  token: string,
  documentId: string,
): Promise<PublicDocumentComment[]> {
  return getDeliveryDocumentCommentsByToken(token, documentId);
}
