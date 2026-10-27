import 'server-only';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { OrgContext } from '@/lib/db/context';
import { countClientEmailsSince, countTeamInviteEmailsSince } from './daily-cap-queries';

// The per-studio daily email caps (S4, go-live security). A free sign-up must
// not turn Metra's verified sender into a relay: spam complaints would get the
// sending domain suspended, and that stops sign-in codes and every client email
// for every studio.
//
// The cap gates the EMAIL, not the action: an invite or a proposal send still
// happens (its link is returned to copy) and only the email is skipped. Only
// the delivery reminder, where the email IS the action, refuses.
//
// A BRAKE, NOT A LOCK: the count is read before the action, so two concurrent
// actions at count = cap - 1 can both pass. That is accepted; the cap bounds a
// loop, it is not an exact quota. Trial and paid studios get the same caps
// until a trial state exists.

export type DailyEmailCap = 'team_invite' | 'client_email';

/** Owner decision D4. Per org, rolling 24 hours. */
export const DAILY_EMAIL_CAPS: Readonly<Record<DailyEmailCap, number>> = { team_invite: 20, client_email: 60 };

export const DAILY_EMAIL_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

const COUNTERS: Readonly<Record<DailyEmailCap, (ctx: OrgContext, since: Date) => Promise<number>>> = {
  team_invite: countTeamInviteEmailsSince,
  client_email: countClientEmailsSince,
};

/**
 * True when the org already used the whole cap (count >= cap). Checked BEFORE the action.
 * Fails OPEN (false) on a DB error, logged; logs the cap (never an address) when reached.
 */
export async function dailyEmailCapReached(ctx: OrgContext, cap: DailyEmailCap): Promise<boolean> {
  let count: number;
  try {
    count = await COUNTERS[cap](ctx, new Date(Date.now() - DAILY_EMAIL_CAP_WINDOW_MS));
  } catch (error) {
    console.error('daily email cap count failed (failing open):', { cap, ...loggableFailure(error) });
    return false;
  }
  const reached = count >= DAILY_EMAIL_CAPS[cap];
  if (reached) console.warn('daily email cap reached:', { cap });
  return reached;
}
