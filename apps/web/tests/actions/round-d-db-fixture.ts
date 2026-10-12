// Shared setup for the Round D database suites (migration 0059 and its apply-rls
// changes). Not a test file: imported by the delivery-db-step-0059 dbtests.
//
// The respond functions are called over the BYPASSRLS connection exactly as the
// TypeScript wrapper calls them: by the sha256 hash of the share token, with
// the issuance instant passed as the TEXT the snapshot returned and cast with
// ::timestamptz, never re-formatted through a JS Date (which keeps
// milliseconds only).
import { reviewSeenOf } from '@/lib/engagements/review-seen';
import { deliveryOrNull } from './delivery-read';
import { raw } from './fixture';
import { snapshotOf } from './round-b-fixture';

/** A SQL literal for a nullable string. */
export function literal(value: string | null): string {
  return value === null ? 'null' : `'${value.replace(/'/g, "''")}'`;
}

/** The consent-guarded write (seven arguments): the code it answers. */
export async function respondSeen(
  hash: string,
  action: string,
  expectedIssueAt: string | null,
  note: string | null = null,
): Promise<string> {
  const [row] = await raw.query<{ code: string }>(
    `select public.app_delivery_respond_by_token(
       '${hash}', '${action}', ${literal(expectedIssueAt)}::timestamptz, ${literal(note)},
       'Client Sam', '1.2.3.4', 'probe/1'
     ) as code`,
  );
  return row.code;
}

/** Issue a band (as issueRomCore leaves it): low, high and the issuance stamp. */
export async function issueBand(engagementId: string, low: number, high: number, atSql = 'now()'): Promise<void> {
  await raw.query(
    `update public.design_engagements set rom_low = ${low}, rom_high = ${high}, rom_issued_at = ${atSql}
      where id = '${engagementId}'`,
  );
}

/** The two issuance instants exactly as the client page receives them. */
export async function issuancesOf(hash: string): Promise<{ rom: string | null; renders: string | null }> {
  const snapshot = (await snapshotOf(hash))!;
  const rom = snapshot.rom as { issued_at: string | null } | null;
  return { rom: rom?.issued_at ?? null, renders: (snapshot.renders_issued_at as string | null) ?? null };
}

/** How many client engagement_events rows a delivery has. */
export async function clientEventCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_events
      where engagement_id = '${engagementId}' and actor_channel = 'client'`,
  );
  return row.n;
}

/** The newest client event of a kind: what it recorded about the issuance it answers. */
export async function newestClientEvent(engagementId: string, kind: string) {
  const [row] = await raw.query<{
    issue_matches_rom: boolean;
    issue_matches_renders: boolean;
    range_low: string | null;
    range_high: string | null;
    actor_name: string | null;
    actor_ip: string | null;
    actor_user_agent: string | null;
  }>(
    `select e.acknowledged_issue_at is not distinct from de.rom_issued_at as issue_matches_rom,
            e.acknowledged_issue_at is not distinct from de.renders_ready_at as issue_matches_renders,
            e.range_low::text as range_low, e.range_high::text as range_high,
            e.actor_name, e.actor_ip, e.actor_user_agent
       from public.engagement_events e
       join public.design_engagements de on de.id = e.engagement_id
      where e.engagement_id = '${engagementId}' and e.actor_channel = 'client' and e.kind = '${kind}'
      order by e.decided_at desc limit 1`,
  );
  return row;
}

/** What the one-tap approve+budget left on file (Round D, AC S1 to S8). */
export interface ConsentCounts {
  designApprovals: number;
  romAcknowledgements: number;
  /** client_responded notification rows per body key. */
  notified: Record<string, number>;
  /** The `budget` param on the design-approval notifications (null when absent). */
  designBudgetParams: Array<string | null>;
}

export async function consentCounts(engagementId: string): Promise<ConsentCounts> {
  const [events] = await raw.query<{ design: number; rom: number }>(
    `select count(*) filter (where kind = 'design_approval')::int as design,
            count(*) filter (where kind = 'rom_acknowledgement')::int as rom
       from public.engagement_events
      where engagement_id = '${engagementId}' and actor_channel = 'client'`,
  );
  const rows = await raw.query<{ body_key: string; budget: string | null }>(
    `select body_key, params ->> 'budget' as budget from public.notifications
      where entity_id = '${engagementId}' and kind = 'client_responded' order by body_key`,
  );
  const notified: Record<string, number> = {};
  for (const row of rows) notified[row.body_key] = (notified[row.body_key] ?? 0) + 1;
  return {
    designApprovals: events.design,
    romAcknowledgements: events.rom,
    notified,
    designBudgetParams: rows.filter((row) => row.body_key === 'client_design_approved').map((row) => row.budget),
  };
}

/** What a dialog with the budget on offer sends: the issuances the page shows now (a band is on it). */
export async function pageSeenWithBand(rawToken: string): Promise<{ romIssuedAt: string; rendersIssuedAt: string | null }> {
  const seen = reviewSeenOf((await deliveryOrNull(rawToken))!);
  return { ...seen, romIssuedAt: seen.romIssuedAt! };
}

/** Whether every client decision row names the issuance on file now (null: no row of that kind). */
export async function issuesNamed(engagementId: string): Promise<{ design: boolean | null; rom: boolean | null }> {
  const [row] = await raw.query<{ design: boolean | null; rom: boolean | null }>(
    `select bool_and(e.acknowledged_issue_at = de.renders_ready_at) filter (where e.kind = 'design_approval') as design,
            bool_and(e.acknowledged_issue_at = de.rom_issued_at) filter (where e.kind = 'rom_acknowledgement') as rom
       from public.engagement_events e join public.design_engagements de on de.id = e.engagement_id
      where e.engagement_id = '${engagementId}' and e.actor_channel = 'client'`,
  );
  return row!;
}
