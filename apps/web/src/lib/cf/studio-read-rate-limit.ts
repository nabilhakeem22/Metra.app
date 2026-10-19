import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { consumeRateLimit, rateLimitBinding } from '@/lib/cf/rate-limit-binding';
import type { OrgContext } from '@/lib/db/context';

// The per-member brake on the studio's expensive reads (lead ruling, Oct 19):
// the rescue ledger route, the contract's baseline line search and the price
// book picker search. One Cloudflare Workers Rate Limiting binding; its ceiling
// lives in apps/web/wrangler.jsonc ONLY (one line).
//
// THE KEY is the surface, the workspace and the member: one budget per member
// per surface in each workspace, so a long session in the picker never spends
// the ledger's budget. Ids only, never a name or an email.
//
// PER DATA CENTRE, NOT GLOBAL, like every binding (lib/cf/rate-limit-binding.ts):
// it stops a loop (a script, a stuck tab); it is not a quota.
//
// FAILURE MODES (owner decision, rate-limit-binding.ts): off-platform everything
// is allowed; a binding error, a timeout or a malformed answer is allowed and
// logged; a MISSING binding on Cloudflare is `misdeployed`, logged by binding
// name every time, and the caller refuses rather than serve the read unlimited.

export const STUDIO_READ_BINDING = 'STUDIO_READ_RATE_LIMITER';

const STUDIO_SURFACE = 'the studio reads';

/** The reads this budget covers, each its own bucket. */
export type StudioReadSurface = 'rescue_ledger' | 'contract_line_search' | 'price_book_picker';

export type StudioReadVerdict = 'allowed' | 'refused' | 'misdeployed';

/** Charges one read of `surface` to this member's budget. Never throws. */
export async function studioReadVerdict(ctx: OrgContext, surface: StudioReadSurface): Promise<StudioReadVerdict> {
  try {
    const key = `${surface}:${ctx.orgId}:${ctx.userId}`;
    const allowed = await consumeRateLimit(rateLimitBinding(STUDIO_READ_BINDING, STUDIO_SURFACE), key, STUDIO_READ_BINDING);
    if (!allowed) console.warn('studio read rate limit refused:', { binding: STUDIO_READ_BINDING, surface });
    return allowed ? 'allowed' : 'refused';
  } catch (error) {
    console.error('studio read limiter unavailable (refusing):', { binding: STUDIO_READ_BINDING, surface, ...loggableFailure(error) });
    return 'misdeployed';
  }
}

/**
 * The same budget for a server action: null when the read may go ahead,
 * `rate_limited` past the budget (the picker says so politely), and a logged
 * `generic` with a reference when the binding is missing on Cloudflare.
 */
export async function studioReadRefusal(ctx: OrgContext, surface: StudioReadSurface): Promise<ActionResult | null> {
  const verdict = await studioReadVerdict(ctx, surface);
  if (verdict === 'allowed') return null;
  return verdict === 'refused' ? err('rate_limited') : unexpectedFailure(`${surface} read limiter missing`);
}
