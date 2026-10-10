// Shared setup for the Round C database suites (migration 0058 and its apply-rls
// functions). Not a test file: imported by the delivery-db-step-0058 dbtests.
//
// Rows are planted over the BYPASSRLS connection (`raw`) where a suite needs an
// exact instant or an act no portal verb can produce (a staff decision with
// evidence, a back-dated client act). The lost-notification sweep is called the
// way the hourly runner will call it: inside withOrgContext, as metra_app, with
// the role map the app's permission matrix gives each act.
import { sql } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { recipientRolesByBodyKey } from '@/lib/engagements/client-acts/acts';
import { raw } from './fixture';
import type { RoundBDelivery } from './round-b-fixture';

/** A SQL literal for a nullable value: `null` or a single-quoted string. */
function literal(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
}

export interface PlantedEvent {
  kind: string;
  channel?: 'client' | 'staff';
  /** A SQL expression for decided_at; defaults to now(). */
  at?: string;
  evidence?: string | null;
  chosenArtifactId?: string | null;
  chosenPosition?: number | null;
  /** A SQL expression for acknowledged_issue_at. */
  issueAt?: string | null;
}

/** Plant one engagement_events row and return its id. */
export async function plantEvent(d: RoundBDelivery, event: PlantedEvent): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `insert into public.engagement_events
       (org_id, engagement_id, kind, actor_channel, evidence, chosen_artifact_id,
        chosen_position, acknowledged_issue_at, decided_at)
     values ('${d.orgId}', '${d.engagementId}', '${event.kind}', '${event.channel ?? 'client'}',
             ${literal(event.evidence)}, ${literal(event.chosenArtifactId)},
             ${literal(event.chosenPosition)}, ${event.issueAt ?? 'null'}, ${event.at ?? 'now()'})
     returning id`,
  );
  return row.id;
}

/** Retract an event the way the studio does: an event_correction pointing at it. */
export async function retract(d: RoundBDelivery, eventId: string): Promise<void> {
  await raw.query(
    `insert into public.engagement_events (org_id, engagement_id, kind, supersedes_event_id)
     values ('${d.orgId}', '${d.engagementId}', 'event_correction', '${eventId}')`,
  );
}

/** Plant one ledger row: a state move (or a self-loop when from = to). */
export async function plantTransition(
  d: RoundBDelivery,
  fromState: string,
  toState: string,
  at: string,
): Promise<void> {
  await raw.query(
    `insert into public.engagement_transitions
       (org_id, engagement_id, trigger, from_state, to_state, actor_user_id, decided_at)
     values ('${d.orgId}', '${d.engagementId}', 'planted', '${fromState}', '${toState}',
             '${d.ownerId}', ${at})`,
  );
}

/** Plant one cleared payment the studio recorded. */
export async function plantPayment(
  d: RoundBDelivery,
  kind: string,
  amount: string,
  at: string,
): Promise<void> {
  await raw.query(
    `insert into public.payment_events (org_id, engagement_id, kind, amount, recorded_by, cleared_at)
     values ('${d.orgId}', '${d.engagementId}', '${kind}', ${amount}, '${d.ownerId}', ${at})`,
  );
}

/** Plant one PENDING client claim on a milestone (the claim function's row shape). */
export async function plantClaim(d: RoundBDelivery, milestone: string, at: string): Promise<void> {
  await raw.query(
    `insert into public.client_payment_claims
       (org_id, engagement_id, milestone_kind, claimed_amount, status, created_at)
     values ('${d.orgId}', '${d.engagementId}', '${milestone}', 1000, 'pending', ${at})`,
  );
}

/**
 * The role map the hourly runner passes: every act's body key -> the member
 * roles the permission matrix says hear about it. The app's own map (the one
 * lib/automation/lost-notifications.ts sends), so the suite exercises the real
 * contract.
 */
export function sweepRoles(): Record<string, string[]> {
  return recipientRolesByBodyKey();
}

export interface SweepEntry {
  body_key: string;
  milestone_kind: string | null;
  notified: { engagement_id: string; notified_count: number; new_recipients: string[] } | null;
}

/** Call the sweep as the runner will: in the org's RLS transaction, as metra_app. */
export async function sweepAs(
  ctx: OrgContext,
  since = `now() - interval '48 hours'`,
  until = `now() - interval '10 minutes'`,
  roles: unknown = sweepRoles(),
): Promise<SweepEntry[] | null> {
  return withOrgContext(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select public.app_notify_lost_client_acts(
        ${sql.raw(since)}, ${sql.raw(until)}, ${JSON.stringify(roles)}::jsonb
      ) as data`)) as unknown as Array<{ data: SweepEntry[] | null }>;
    return rows[0].data;
  });
}

/** client_responded notifications of one delivery, as (recipient, body key, milestone). */
export async function notificationsOf(engagementId: string) {
  return raw.query<{ recipient_user_id: string; body_key: string; milestone: string | null; count: number }>(
    `select recipient_user_id, body_key, params ->> 'milestoneKind' as milestone,
            (params ->> 'count')::int as count
       from public.notifications
      where entity_id = '${engagementId}' and kind = 'client_responded'
      order by body_key, milestone`,
  );
}
