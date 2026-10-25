import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { consumeRateLimit, rateLimitBinding } from '@/lib/cf/rate-limit-binding';
import type { OrgContext } from '@/lib/db/context';

// The per-member brake on the studio's expensive reads (lead rulings, Oct 19
// and 20), on two Cloudflare Workers Rate Limiting bindings whose ceilings live
// in apps/web/wrangler.jsonc ONLY (one line each):
//   STUDIO_READ_RATE_LIMITER   the rescue ledger route (fetched on mount, on a
//                              range change and on retry; never polled);
//   STUDIO_SEARCH_RATE_LIMITER the typed searches: the contract line pickers
//                              (a variation line, a cost entry) and the price
//                              book picker, which ask once per pause in
//                              typing, the market prices search
//                              (/market-book?q=, once per submitted search),
//                              the price book's market link combobox
//                              (once per pause in typing), and the project
//                              site team picker (once per pause in typing,
//                              and once per page it fills).
//
// THE KEY is the surface, the workspace and the member: one budget per member
// per surface in each workspace, so one picker never spends the other's.
// Ids only, never a name or an email.
//
// PER DATA CENTRE, NOT GLOBAL, like every binding (lib/cf/rate-limit-binding.ts):
// it stops a loop (a script, a stuck tab); it is not a quota.
//
// FAILURE MODES (owner decision, rate-limit-binding.ts): off-platform everything
// is allowed; a binding error, a timeout or a malformed answer is allowed and
// logged; a MISSING binding on Cloudflare is `misdeployed`, logged by binding
// name every time, and the caller refuses rather than serve the read unlimited.


const STUDIO_SURFACE = 'the studio reads';

/** Each surface's binding; each surface is its own bucket within it. */
const STUDIO_READ_BINDINGS = {
  rescue_ledger: 'STUDIO_READ_RATE_LIMITER',
  contract_line_search: 'STUDIO_SEARCH_RATE_LIMITER',
  price_book_picker: 'STUDIO_SEARCH_RATE_LIMITER',
  market_search: 'STUDIO_SEARCH_RATE_LIMITER',
  market_link_search: 'STUDIO_SEARCH_RATE_LIMITER',
  site_team_candidates: 'STUDIO_SEARCH_RATE_LIMITER',
} as const;

export type StudioReadSurface = keyof typeof STUDIO_READ_BINDINGS;

export type StudioReadVerdict = 'allowed' | 'refused' | 'misdeployed';

/** Charges one read of `surface` to this member's budget. Never throws. */
export async function studioReadVerdict(ctx: OrgContext, surface: StudioReadSurface): Promise<StudioReadVerdict> {
  const binding = STUDIO_READ_BINDINGS[surface];
  try {
    const key = `${surface}:${ctx.orgId}:${ctx.userId}`;
    const allowed = await consumeRateLimit(rateLimitBinding(binding, STUDIO_SURFACE), key, binding);
    if (!allowed) console.warn('studio read rate limit refused:', { binding, surface });
    return allowed ? 'allowed' : 'refused';
  } catch (error) {
    console.error('studio read limiter missing (refusing):', { binding, surface, ...loggableFailure(error) });
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
