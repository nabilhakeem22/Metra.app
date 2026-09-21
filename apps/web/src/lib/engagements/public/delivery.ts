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
import { loggableFailure } from '@/lib/actions/loggable-failure';
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
 * Why the portal has nothing to render.
 *
 * `not_found` is PERMANENT — an unknown, revoked or expired token, or a snapshot
 * this build cannot render. `read_failed` is TRANSIENT: the database or the SDF
 * threw, the client's link is still perfectly valid, and the honest thing to say
 * is "try again in a moment" rather than "this link does not work".
 *
 * ONE null was the whole defect (W3-7): a client re-opening a VALID link during
 * a database blip was told their link was dead. It is the only open item in this
 * wave that a paying firm's own client can see.
 */
export type DeliveryReadResult =
  | { status: 'ok'; delivery: PublicDelivery }
  | { status: 'not_found' }
  | { status: 'read_failed' };

/**
 * Resolve a delivery by its RAW share token. Server-only; never logs the raw
 * token.
 *
 * HARDENED (read-path defense): the SDF execute AND the whole mapping run inside
 * ONE try/catch. A VALID token can never 500 — any throw logs a token-free
 * breadcrumb and answers `read_failed`, which the page renders as "we could not
 * load this, your link is still valid"; a token that resolves to nothing, and a
 * snapshot this build cannot shape, answer `not_found`.
 *
 * THE BREADCRUMB CARRIES THE ERROR, REDACTED. It used to carry only
 * `hasSnapshot`, so a transient database failure and an expired link produced
 * the same dead page for the client AND the same one-boolean log line for
 * on-call — the two things nobody can tell apart at 3am are exactly the two this
 * catch covers.
 *
 * IT GOES THROUGH `loggableFailure`, AND THIS IS THE SITE THAT NEEDS IT MOST.
 * The line above this one used to say the thrown error was "token-free", and on
 * drizzle 0.36 it was. It is not any more: the SDF call is a parameterised
 * `db.execute`, so from drizzle 0.44 the throw is a `DrizzleQueryError` whose
 * `params` — and whose message — are the arguments this file passed, and the one
 * argument it passes is `hashShareToken(token)`. Logging the raw error would
 * write the share-link hash of an identified client into Workers Logs on every
 * database blip, from the app's ONLY unauthenticated entry point. The whitelist
 * copies five fields off the DRIVER error and never the wrapper's message or its
 * params, so the hash does not travel. The raw token still never reaches this
 * scope at all.
 */
export async function getDeliveryByToken(
  rawToken: string,
): Promise<DeliveryReadResult> {
  // Distinguishes "the SDF call itself threw" from "mapping a returned snapshot
  // threw" — WITHOUT logging the token or any client data.
  let hasSnapshot = false;
  try {
    const snapshot = await loadDeliverySnapshot(rawToken);
    if (!snapshot) return { status: 'not_found' };
    hasSnapshot = true;
    const delivery = shapeDelivery(snapshot);
    return delivery ? { status: 'ok', delivery } : { status: 'not_found' };
  } catch (error) {
    console.error('delivery read failed', {
      hasSnapshot,
      error: loggableFailure(error),
    });
    return { status: 'read_failed' };
  }
}
