/**
 * The share-link token: how it is minted, how it is hashed, and how long it lives.
 *
 * SERVER-SIDE (node:crypto). Deliberately NOT client-safe, and deliberately not
 * re-exported from any client-safe module — see the note on SHARE_TTL_DAYS.
 *
 * THE RULE THIS MODULE EXISTS TO KEEP: the raw token is returned to the caller
 * exactly once, at mint time, to be put in a link. Only the sha256 hash is ever
 * stored, compared or logged. The minting was written twice and the hashing six
 * times (four private `hashToken` copies, one in a comment-lookalike, one inlined
 * at a call site). Six copies of a security primitive is six places for one to
 * quietly stop trimming, or to start logging what it received.
 */
import { createHash, randomBytes } from 'node:crypto';

/** How long a document share link stays usable. Lives here, with the token, so
 *  the lifetime and the secret cannot be reasoned about separately. */
export const SHARE_TTL_DAYS = 30;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * A fresh share token: 256 bits of CSPRNG entropy, base64url so it survives a URL
 * without escaping, plus its sha256 hash.
 *
 * `raw` is the ONLY copy of the secret and must go straight into the link. `hash`
 * is what the row stores, because a leaked database dump must not be a set of
 * working share links.
 */
export function mintShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashShareToken(raw) };
}

/**
 * The lookup key for a raw token presented by a visitor.
 *
 * TRIMS first, always. A token arrives from a URL that has been copied out of an
 * email or a WhatsApp message, and both readily add a trailing space or newline —
 * every call site was already writing `hashToken(rawToken.trim())` by hand, and
 * one that forgot would turn a valid link into `token_invalid` for that client
 * with no way to tell why.
 */
export function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex');
}

/** When a link minted right now stops working. */
export function shareExpiryFromNow(days: number = SHARE_TTL_DAYS): Date {
  return new Date(Date.now() + days * MILLISECONDS_PER_DAY);
}
