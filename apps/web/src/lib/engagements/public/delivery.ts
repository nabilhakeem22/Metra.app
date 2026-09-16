import 'server-only';
// Public (no-session) client delivery portal — the READ. Runs the SECURITY
// DEFINER token SDF on the base connection — NO withOrgContext, NO org GUCs, NO
// can(). The token IS the auth (mirrors lib/proposals/public.ts). The SDF
// physically omits every cost/margin/build-cost/token/internal column, so nothing
// here can leak the firm's cost. The raw token is never logged.
//
// The snapshot → PublicDelivery mapping is ./delivery-shape.ts: pure, and
// therefore testable without a socket. This file owns the two things that are
// not pure — the token round trip, and what happens when something throws.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { shapeDelivery } from './delivery-shape';
import type { DeliverySnapshot } from './row-guards';
import type { PublicDelivery } from './types';

/**
 * The snapshot behind a RAW share token, or null.
 *
 * The token is sha256-hashed here and never sent to the database in the clear;
 * the SDF answers null for an unknown, revoked or expired link, which is the
 * same answer a blank token gets — telling a visitor which it was is an oracle.
 */
async function loadDeliverySnapshot(
  rawToken: string,
): Promise<DeliverySnapshot | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const hash = hashShareToken(token);
  return readSdfJson<DeliverySnapshot>(
    sql`select public.app_delivery_by_token(${hash}) as data`,
  );
}

/**
 * Resolve a delivery by its RAW share token, or null. Server-only; never logs
 * the raw token.
 *
 * HARDENED (read-path defense): the SDF execute AND the whole mapping run inside
 * ONE try/catch. A VALID token can never 500 — any throw (or any malformed
 * field) logs a token-free breadcrumb and returns null, which the page renders
 * as the friendly not-found.
 *
 * THE BREADCRUMB CARRIES THE ERROR. It used to carry only `hasSnapshot`, so a
 * transient database failure and an expired link produced the same dead page for
 * the client AND the same one-boolean log line for on-call — the two things
 * nobody can tell apart at 3am are exactly the two this catch covers. The error
 * object is server-side and token-free: the token never reaches this scope as
 * anything but the hash, and the snapshot's client data is not in the throw.
 */
export async function getDeliveryByToken(
  rawToken: string,
): Promise<PublicDelivery | null> {
  // Distinguishes "the SDF call itself threw" from "mapping a returned snapshot
  // threw" — WITHOUT logging the token or any client data.
  let hasSnapshot = false;
  try {
    const snapshot = await loadDeliverySnapshot(rawToken);
    if (!snapshot) return null;
    hasSnapshot = true;
    return shapeDelivery(snapshot);
  } catch (error) {
    console.error('delivery read failed', { hasSnapshot, error });
    return null;
  }
}
