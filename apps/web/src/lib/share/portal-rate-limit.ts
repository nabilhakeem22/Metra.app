import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { consumeRateLimit, rateLimitBinding } from '@/lib/cf/rate-limit-binding';
import { hashShareToken } from './token';

// The client portal's per-link brake (Round D), on two Cloudflare Workers Rate
// Limiting bindings. Their ceilings live in apps/web/wrangler.jsonc ONLY (one
// line each), so changing a ceiling is a one-line config change:
//   PORTAL_ACT_RATE_LIMITER  every server action under /d/[token] (the review
//                            acts, the payment claim, a comment).
//   PORTAL_READ_RATE_LIMITER the document and logo routes and a document's
//                            comment thread.
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
// everything is allowed; a binding error, a timeout or a malformed answer is
// allowed and logged; a MISSING binding on Cloudflare rejects, naming the
// binding, so the act is refused. Every refusal past the budget logs one
// warning naming the binding and the kind (never the key or the token).

const PORTAL_SURFACE = 'the client portal';
const LINK_KEY_LENGTH = 32;
const PORTAL_BUDGETS = {
  act: 'PORTAL_ACT_RATE_LIMITER',
  read: 'PORTAL_READ_RATE_LIMITER',
} as const;
type PortalBudget = keyof typeof PORTAL_BUDGETS;

/** The bucket key of one link, or null when the token names no link. */
function linkKey(rawToken: unknown): string | null {
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  return token ? hashShareToken(token).slice(0, LINK_KEY_LENGTH) : null;
}

async function chargeLink(kind: PortalBudget, rawToken: unknown): Promise<boolean> {
  const key = linkKey(rawToken);
  if (key === null) return true;
  const binding = PORTAL_BUDGETS[kind];
  const allowed = await consumeRateLimit(rateLimitBinding(binding, PORTAL_SURFACE), key, binding);
  if (!allowed) console.warn('portal rate limit refused:', { binding, kind });
  return allowed;
}

/** May this link act now? Counts the attempt. Rejects when the binding is missing on Cloudflare. */
export async function portalActAllowed(rawToken: unknown): Promise<boolean> {
  return chargeLink('act', rawToken);
}

/** May this link read a file, the logo or a comment thread now? Counts the attempt. Rejects like portalActAllowed. */
export async function portalReadAllowed(rawToken: unknown): Promise<boolean> {
  return chargeLink('read', rawToken);
}

/**
 * The read verdict for a ROUTE, which must answer in its own documented
 * vocabulary rather than with a bare 500: `misdeployed` means the read binding
 * is missing on Cloudflare, and is logged by binding name every time so a
 * misdeployed Worker is never silent.
 */
export async function portalReadVerdict(rawToken: unknown): Promise<'allowed' | 'refused' | 'misdeployed'> {
  try {
    return (await portalReadAllowed(rawToken)) ? 'allowed' : 'refused';
  } catch (error) {
    console.error('portal read limiter unavailable (refusing):', {
      binding: PORTAL_BUDGETS.read,
      ...loggableFailure(error),
    });
    return 'misdeployed';
  }
}
