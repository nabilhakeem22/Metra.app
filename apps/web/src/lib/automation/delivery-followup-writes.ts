import 'server-only';
// The delivery follow-up core's database work in TWO statements (Round C, R1, R3).
// Through Hyperdrive every parameterised statement costs a few round trips, so
// the claim of the day, the week's earlier reminders and the recipients are one
// statement, and the claims of the day's picks with their notifications are the
// other. Both run inside the org's RLS transaction, as the system actor; the
// notifications insert has no RETURNING (their SELECT policy is the recipient's,
// notifications/core.ts).
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export const DAY_KEY = 'delivery';
export const WEEKLY_KEY = 'delivery-followup';

export interface FollowupDay {
  /** This run won the day's claim (else another run already did the day). */
  won: boolean;
  /** Delivery ids already reminded in this ISO week. */
  remindedThisWeek: Set<string>;
  /** The org's owners and admins: the only follow-up recipients. */
  ownerIds: string[];
}

/** Claim the Cairo day, and read the week's earlier reminders and the recipients, in one statement. */
export async function claimFollowupDay(tx: MetraDb, orgId: string, today: string, week: string): Promise<FollowupDay> {
  const [row] = (await tx.execute(sql`
    with day_claim as (
      insert into public.automation_run_log (org_id, automation_key, period_key)
      values (${orgId}::uuid, ${DAY_KEY}, ${today})
      on conflict (org_id, automation_key, period_key) do nothing
      returning 1)
    select exists (select 1 from day_claim) as won,
           coalesce((select json_agg(period_key) from public.automation_run_log
                      where automation_key = ${WEEKLY_KEY} and period_key like ${`%:${week}`}), '[]')::text as reminded,
           coalesce((select json_agg(user_id) from public.memberships
                      where role in ('owner', 'admin')), '[]')::text as owners`)) as unknown as Array<{
    won: boolean;
    reminded: string;
    owners: string;
  }>;
  const suffix = `:${week}`;
  return {
    won: row.won,
    remindedThisWeek: new Set((JSON.parse(row.reminded) as string[]).map((key) => key.slice(0, -suffix.length))),
    ownerIds: JSON.parse(row.owners) as string[],
  };
}

export interface FollowupPick {
  engagementId: string;
  params: Record<string, unknown>;
}

/**
 * Claim each pick for this ISO week and, for the claims this run won, write one
 * notification per owner or admin, in one statement. Answers the engagement ids
 * whose claim this run won (a concurrent run's claim is simply absent).
 */
export async function claimAndNotifyFollowups(
  tx: MetraDb,
  orgId: string,
  week: string,
  picks: readonly FollowupPick[],
  ownerIds: readonly string[],
): Promise<Set<string>> {
  if (picks.length === 0) return new Set();
  const candidates = JSON.stringify(
    picks.map((pick) => ({ period_key: `${pick.engagementId}:${week}`, engagement_id: pick.engagementId, params: pick.params })),
  );
  const rows = (await tx.execute(sql`
    with picks as (
      select * from jsonb_to_recordset(${candidates}::jsonb) as p(period_key text, engagement_id uuid, params jsonb)),
    won as (
      insert into public.automation_run_log (org_id, automation_key, period_key)
      select ${orgId}::uuid, ${WEEKLY_KEY}, period_key from picks
      on conflict (org_id, automation_key, period_key) do nothing
      returning period_key),
    notified as (
      insert into public.notifications (org_id, recipient_user_id, kind, entity_type, entity_id, body_key, params)
      select ${orgId}::uuid, owner.user_id::uuid, 'delivery_followup', 'engagement', picks.engagement_id,
             'delivery_waiting_on_client', picks.params
        from won
        join picks using (period_key)
        cross join jsonb_array_elements_text(${JSON.stringify(ownerIds)}::jsonb) as owner(user_id))
    select picks.engagement_id::text as engagement_id from won join picks using (period_key)`)) as unknown as Array<{
    engagement_id: string;
  }>;
  return new Set(rows.map((row) => row.engagement_id));
}
