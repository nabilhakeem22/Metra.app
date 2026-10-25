// Set-up for the rescue ledger dbtests: an org with every studio role and
// deliveries whose ledger rows (transitions, payments, change orders, follow up
// alerts, reminders) are written with EXPLICIT timestamps over the BYPASSRLS
// connection, so each rule's record order is exactly what a case states. No new
// table, so the fixture's teardown already covers every row. Not a test file.
import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { loadRescueLedgerCore } from '@/lib/dashboard/rescue-ledger/core';
import type { RescueLedger } from '@/lib/dashboard/rescue-ledger/types';
import type { OrgContext } from '@/lib/db/context';
import { ctxFor, raw, seedOrg } from './fixture';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export interface RescueOrg {
  orgId: string;
  clientId: string;
  ownerId: string;
  contexts: Record<MemberRole, OrgContext>;
}

const ROLES: MemberRole[] = ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer'];

export async function rescueOrg(orgIds: string[]): Promise<RescueOrg> {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members: ROLES.map((role) => ({ role })) });
  orgIds.push(orgId);
  const clientId = randomUUID();
  await raw.query(`insert into public.clients (id, org_id, name_en) values ('${clientId}', '${orgId}', 'Client')`);
  const contexts = { owner: ctxFor(orgId, ownerIds[0], 'owner') } as Record<MemberRole, OrgContext>;
  ROLES.forEach((role, index) => (contexts[role] = ctxFor(orgId, memberIds[index], role)));
  return { orgId, clientId, ownerId: ownerIds[0], contexts };
}

const iso = (at: Date) => at.toISOString();

/** One delivery on its own project (one active delivery per project). */
export async function delivery(org: RescueOrg, number: number): Promise<string> {
  const projectId = randomUUID();
  const engagementId = randomUUID();
  await raw.query(
    `insert into public.projects (id, org_id, code, name_en, client_id) values ('${projectId}', '${org.orgId}', 'P-${number}', 'P ${number}', '${org.clientId}')`,
  );
  await raw.query(
    `insert into public.design_engagements (id, org_id, number, client_id, project_id, title_en)
     values ('${engagementId}', '${org.orgId}', ${number}, '${org.clientId}', '${projectId}', 'Delivery ${number}')`,
  );
  return engagementId;
}

export async function transition(org: RescueOrg, engagementId: string, trigger: string, from: string, to: string, at: Date): Promise<void> {
  await raw.query(
    `insert into public.engagement_transitions (org_id, engagement_id, trigger, from_state, to_state, actor_user_id, decided_at)
     values ('${org.orgId}', '${engagementId}', '${trigger}', '${from}', '${to}', '${org.ownerId}', '${iso(at)}')`,
  );
}

export async function payment(org: RescueOrg, engagementId: string, kind: string, amount: string, at: Date): Promise<string> {
  const id = randomUUID();
  await raw.query(
    `insert into public.payment_events (id, org_id, engagement_id, kind, amount, cleared_at, recorded_by)
     values ('${id}', '${org.orgId}', '${engagementId}', '${kind}', ${amount}, '${iso(at)}', '${org.ownerId}')`,
  );
  return id;
}

/** The fee schedule row the gate's guard reads: an `amount` milestone, or a `percent` one of `designFee`. */
export async function milestone(
  org: RescueOrg,
  engagementId: string,
  kind: string,
  value: string,
  basis: 'amount' | 'percent' = 'amount',
  designFee?: string,
): Promise<void> {
  await raw.query(
    `insert into public.engagement_milestones (org_id, engagement_id, kind, basis, value)
     values ('${org.orgId}', '${engagementId}', '${kind}', '${basis}', ${value})`,
  );
  if (designFee) await raw.query(`update public.design_engagements set design_fee = ${designFee} where id = '${engagementId}'`);
}

export async function changeOrder(org: RescueOrg, engagementId: string, amount: string, at: Date): Promise<void> {
  await raw.query(
    `insert into public.engagement_change_orders (org_id, engagement_id, amount, raised_by_user_id, raised_at)
     values ('${org.orgId}', '${engagementId}', ${amount}, '${org.ownerId}', '${iso(at)}')`,
  );
}

/** The cron's weekly follow up alert, keyed as the writer keys it. */
export async function followupAlert(org: RescueOrg, engagementId: string, at: Date): Promise<void> {
  await raw.query(
    `insert into public.automation_run_log (org_id, automation_key, period_key, created_at)
     values ('${org.orgId}', 'delivery-followup', '${engagementId}:${randomUUID()}', '${iso(at)}')`,
  );
}

/** A reminder audit row: 'email', 'email_failed' or 'prepared'. */
export async function reminder(org: RescueOrg, engagementId: string, kind: string, at: Date): Promise<void> {
  await raw.query(
    `insert into public.audit_log (org_id, actor_user_id, at, entity, entity_id, action, after)
     values ('${org.orgId}', '${org.ownerId}', '${iso(at)}', 'design_engagement', '${engagementId}', 'issue', '{"reminder":"${kind}"}')`,
  );
}

/** The 'YYYY-MM' the database buckets `at` into (its own time zone, as the ledger does). */
export async function monthOf(at: Date): Promise<string> {
  const [row] = await raw.query<{ month: string }>(`select to_char(date_trunc('month', '${iso(at)}'::timestamptz), 'YYYY-MM') as month`);
  return row.month;
}

/** The owner's ledger for `range` months; a refusal fails the test with its code. */
export async function ledgerOf(org: RescueOrg, range: 3 | 6 | 12 = 6): Promise<RescueLedger> {
  const result = await loadRescueLedgerCore(org.contexts.owner, { range });
  if (!result.ok) throw new Error(`ledger refused: ${result.error}`);
  return result.data;
}
