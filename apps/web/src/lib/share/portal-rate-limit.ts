import 'server-only';
import { consumeRateLimit, rateLimitBinding } from '@/lib/cf/rate-limit-binding';
import { hashShareToken } from './token';

// The client portal's per-link brake (Round D), on two Cloudflare Workers Rate
// Limiting bindings declared in apps/web/wrangler.jsonc:
//   PORTAL_ACT_RATE_LIMITER   30 a minute per link: every server action under
//                             /d/[token] (the review acts, the payment claim,
//                             a comment).
//   PORTAL_READ_RATE_LIMITER 300 a minute per link: the document and logo
//                             routes and a document's comment thread.
// The page GET itself is not limited (owner decision).
//
// PER DATA CENTRE, NOT GLOBAL: a link used from k colos gets k x the limit. It
// stops a loop (a script, a stuck tab); it is not a quota.
//
// THE KEY is the first 32 hex characters of the token's sha256, never the raw
// token. A non-string or blank token is not counted: every caller refuses it
// on its own anyway, and it names no link to count against.
//
// FAILURE MODES (owner decision, lib/cf/rate-limit-binding.ts): off-platform
// everything is allowed; a binding ERROR is allowed and logged; a MISSING
// binding on Cloudflare rejects, naming the binding, so the act is refused.

/** The seconds a refused read is told to wait (the bindings' period). */
export const PORTAL_RETRY_AFTER_SECONDS = 60;

const PORTAL_SURFACE = 'the client portal';
const LINK_KEY_LENGTH = 32;

/** The bucket key of one link, or null when the token names no link. */
function linkKey(rawToken: unknown): string | null {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  return token ? hashShareToken(token).slice(0, LINK_KEY_LENGTH) : null;
}

async function chargeLink(bindingName: string, rawToken: unknown): Promise<boolean> {
  const key = linkKey(rawToken);
  if (key === null) return true;
  return consumeRateLimit(rateLimitBinding(bindingName, PORTAL_SURFACE), key);
}

/** May this link act now (30 a minute)? Counts the attempt. */
export async function portalActAllowed(rawToken: unknown): Promise<boolean> {
  return chargeLink('PORTAL_ACT_RATE_LIMITER', rawToken);
}

/** May this link read a file, the logo or a comment thread now (300 a minute)? Counts the attempt. */
export async function portalReadAllowed(rawToken: unknown): Promise<boolean> {
  return chargeLink('PORTAL_READ_RATE_LIMITER', rawToken);
}
