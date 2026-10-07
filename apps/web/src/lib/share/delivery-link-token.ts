import 'server-only';
/**
 * The delivery's client link, made RE-DERIVABLE (Round B, B11; owner decision Q1).
 *
 * WHY. A reminder on WhatsApp must carry the link the client ALREADY holds;
 * minting a new one would kill theirs. share/token.ts stores only sha256(raw),
 * so the raw link was unrecoverable by design. Now the raw token is an HMAC of
 * the engagement id and a per-link random nonce under the Worker secret
 * `SHARE_LINK_SECRET`:
 *
 *   raw  = HMAC-SHA256(secret, "metra.delivery-link.v1:<engagementId>:<nonce>")
 *   hash = sha256(raw)        stored in design_engagements.token_hash, as before
 *   nonce                     stored in design_engagements.token_nonce (0056)
 *
 * A database dump alone still opens nothing: it has the nonce and the hash, not
 * the secret. The database AND the secret together re-create the link, which is
 * the trade the owner accepted.
 *
 * NO SECRET (unset, or too short to be one): minting falls back to today's
 * random token with a null nonce, and nothing is re-derivable. Every link keeps
 * working either way.
 *
 * THE HASH CHECK IS THE GUARANTEE. Re-deriving returns a link only when its
 * sha256 equals the STORED hash. A nonce left next to a newer hash (a writer
 * that predates the nonce; the 0056 trigger clears it, this is the second
 * wall), or a rotated secret, re-derives a token that does not match, and the
 * answer is null rather than a dead or, worse, a superseded link.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { runtimeSecret } from '@/lib/cf/secrets';
import { hashShareToken, mintShareToken } from './token';

/** Versioned, so a future scheme can never re-derive a v1 link by accident. */
const DERIVATION_DOMAIN = 'metra.delivery-link.v1';

/** 32 characters at the least: anything shorter is a placeholder, not a key. */
const MIN_SECRET_LENGTH = 32;

export interface DeliveryLinkToken {
  /** Goes into the link, once; never stored, never logged. */
  raw: string;
  /** sha256(raw): what the row stores and the portal looks up. */
  hash: string;
  /** The per-link nonce, or null when the link is not re-derivable. */
  nonce: string | null;
}

/** One warning per isolate, so a misconfigured deployment is visible without flooding the log. */
let warnedMissingSecret = false;

function linkSecret(): string | null {
  const secret = runtimeSecret('SHARE_LINK_SECRET');
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    // The NAME only, never a value, a length or a prefix.
    console.warn('SHARE_LINK_SECRET is missing or too short: delivery links cannot be shown again or resent');
  }
  return null;
}

/**
 * Can links be re-derived on this deployment at all? When not, a "replace the
 * link" would kill the client's working link and STILL not be resendable, so
 * the studio is told the server needs configuring instead.
 */
export function deliveryLinkSecretConfigured(): boolean {
  return linkSecret() !== null;
}

function deriveRaw(secret: string, engagementId: string, nonce: string): string {
  return createHmac('sha256', secret)
    .update(`${DERIVATION_DOMAIN}:${engagementId}:${nonce}`)
    .digest('base64url');
}

/** Constant-time equality of two hex digests. */
function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A new link for `engagementId`: re-derivable (128-bit nonce) when the secret
 * is set, else a plain random token with `nonce: null`.
 */
export function mintDeliveryLinkToken(engagementId: string): DeliveryLinkToken {
  const secret = linkSecret();
  if (!secret) return { ...mintShareToken(), nonce: null };
  const nonce = randomBytes(16).toString('base64url');
  const raw = deriveRaw(secret, engagementId, nonce);
  return { raw, hash: hashShareToken(raw), nonce };
}

/**
 * The raw token of the link the client holds now, or null when it cannot be
 * re-created: no nonce (a link minted before Round B or without the secret),
 * no stored hash (no live link), no secret, or a derived token whose hash is
 * not the stored one (rotated secret, stale nonce).
 */
export function rederiveDeliveryLinkToken(
  engagementId: string,
  nonce: string | null,
  storedHash: string | null,
): string | null {
  if (!nonce || !storedHash) return null;
  const secret = linkSecret();
  if (!secret) return null;
  const raw = deriveRaw(secret, engagementId, nonce);
  return sameDigest(hashShareToken(raw), storedHash) ? raw : null;
}
