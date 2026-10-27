import 'server-only';
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
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
// A LOCK, NOT A BRAKE (fix round T2): the claim runs INSIDE the transaction
// that writes the row the count reads, behind a transaction lock on (org,
// cap). A concurrent claim waits until that row commits and then counts it, so
// 150 concurrent invites send exactly the cap. Trial and paid studios get the
// same caps until a trial state exists.

export type DailyEmailCap = 'team_invite' | 'client_email';

/** Owner decision D4. Per org, rolling 24 hours. */
export const DAILY_EMAIL_CAPS: Readonly<Record<DailyEmailCap, number>> = { team_invite: 20, client_email: 60 };

export const DAILY_EMAIL_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

const COUNTERS: Readonly<Record<DailyEmailCap, (tx: MetraDb, since: Date) => Promise<number>>> = {
  team_invite: countTeamInviteEmailsSince,
  client_email: countClientEmailsSince,
};

/** Every claim on one org's cap waits here until the claiming transaction ends (commit or rollback). */
async function lockCap(tx: MetraDb, orgId: string, cap: DailyEmailCap): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:email-cap:${cap}`}))`);
}

async function lockedCount(tx: MetraDb, orgId: string, cap: DailyEmailCap): Promise<number> {
  // A savepoint: postgres.js fails the whole transaction on any failed
  // statement, and a failed count must not undo the caller's write.
  return tx.transaction(async (savepoint) => {
    const scoped = savepoint as unknown as MetraDb;
    await lockCap(scoped, orgId, cap);
    return COUNTERS[cap](scoped, new Date(Date.now() - DAILY_EMAIL_CAP_WINDOW_MS));
  });
}

/**
 * Claims one email against the org's daily cap: true = it may go out (count <
 * cap). MUST run inside the withOrgContext write transaction that then writes
 * the row the cap counts (the invitation audit row, the proposal's `sent`
 * event, the reminder audit row). Fails OPEN (true) on a database error,
 * logged; logs the cap (never an address) when reached.
 */
export async function claimDailyEmail(tx: MetraDb, orgId: string, cap: DailyEmailCap): Promise<boolean> {
  let count: number;
  try {
    count = await lockedCount(tx, orgId, cap);
  } catch (error) {
    console.error('daily email cap count failed (failing open):', { cap, ...loggableFailure(error) });
    return true;
  }
  const reached = count >= DAILY_EMAIL_CAPS[cap];
  if (reached) console.warn('daily email cap reached:', { cap });
  return !reached;
}
