import 'server-only';
import { auditLog, type AuditAction, type MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export interface AuditEntry {
  entity: string;
  entityId?: string | null;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}

/**
 * Appends an immutable audit row (§4.4). `org_id` and `actor_user_id` are taken
 * from the ambient request GUCs, so this MUST be called inside a withOrgContext
 * transaction (pass that tx). metra_app has INSERT but not UPDATE/DELETE on
 * audit_log, so history cannot be rewritten.
 */
export async function recordAudit(
  tx: MetraDb,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: sql`current_setting('app.current_org_id', true)::uuid`,
    actorUserId: sql`current_setting('app.current_user_id', true)::uuid`,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    action: entry.action,
    before: (entry.before ?? null) as never,
    after: (entry.after ?? null) as never,
  });
}
