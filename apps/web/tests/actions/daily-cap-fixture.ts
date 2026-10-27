import { raw } from './fixture';

// TEST-ONLY. The rows the daily email caps count (lib/email/daily-cap-queries.ts),
// written straight over the BYPASSRLS connection so a test can stand an org at
// its cap, or past the window, without performing 60 real sends.

interface AuditRows {
  entity: string;
  action: 'create' | 'update' | 'issue';
  after: Record<string, unknown>;
  /** How long ago the rows were written; 1 hour (inside the window) by default. */
  hoursAgo?: number;
}

/** `count` audit rows for `orgId`, written by `actorId`. */
export async function seedAuditRows(orgId: string, actorId: string, count: number, rows: AuditRows): Promise<void> {
  await raw.query(
    `insert into public.audit_log (org_id, actor_user_id, at, entity, entity_id, action, before, after)
     select '${orgId}', '${actorId}', now() - make_interval(hours => ${rows.hoursAgo ?? 1}), '${rows.entity}',
            gen_random_uuid(), '${rows.action}', null, '${JSON.stringify(rows.after)}'::jsonb
     from generate_series(1, ${count})`,
  );
}

/** `count` proposal_events kind='sent' rows on `proposalId`, an hour old. */
export async function seedSentProposalEvents(orgId: string, proposalId: string, count: number): Promise<void> {
  await raw.query(
    `insert into public.proposal_events (org_id, proposal_id, kind, from_status, to_status, created_at)
     select '${orgId}', '${proposalId}', 'sent', 'draft', 'sent', now() - interval '1 hour'
     from generate_series(1, ${count})`,
  );
}

/** How many audit rows `orgId` holds for `entity`. */
export async function auditRowCount(orgId: string, entity: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.audit_log where org_id = '${orgId}' and entity = '${entity}'`,
  );
  return row.n;
}
