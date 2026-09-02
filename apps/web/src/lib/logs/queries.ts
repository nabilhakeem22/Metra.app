import 'server-only';
// The Logs feed for one entity: the activity feed and the audit trail, merged.
//
// The audit READER did not exist before this — `lib/audit.ts` only ever wrote. That
// is why the Logs tab could not simply be repointed at "the log system": there was
// nothing to point at.
import { activities, auditLog, type ActivityEntityType } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { mergeLogEntries, type LogEntry } from './entries';

/** How many rows each source contributes before the merge. Read more than the
 *  final cap from each, so a burst in one source cannot crowd the other out of the
 *  window entirely. */
const PER_SOURCE_LIMIT = 50;

/**
 * The merged Logs feed for one entity, newest first.
 *
 * Both reads are RLS-scoped, so this can only ever see the caller's own org. A
 * malformed id returns an empty feed rather than throwing — a log panel that
 * explodes is worse than one that is empty.
 */
export async function listEntityLogs(
  ctx: OrgContext,
  entityType: ActivityEntityType,
  entityId: string,
  limit = 50,
): Promise<LogEntry[]> {
  if (!isUuid(entityId)) return [];

  return withOrgContext(ctx, async (tx) => {
    const [activityRows, auditRows] = await Promise.all([
      tx
        .select({
          id: activities.id,
          at: activities.createdAt,
          actorUserId: activities.actorUserId,
          kind: activities.kind,
          note: activities.note,
        })
        .from(activities)
        .where(
          and(
            eq(activities.entityType, entityType),
            eq(activities.entityId, entityId),
          ),
        )
        .orderBy(desc(activities.createdAt))
        .limit(PER_SOURCE_LIMIT),
      tx
        .select({
          id: auditLog.id,
          at: auditLog.at,
          actorUserId: auditLog.actorUserId,
          entity: auditLog.entity,
          action: auditLog.action,
        })
        .from(auditLog)
        // `audit_log.entity` is the same vocabulary as `activities.entity_type`
        // ('client', 'project'), so one id filter serves both.
        .where(and(eq(auditLog.entity, entityType), eq(auditLog.entityId, entityId)))
        .orderBy(desc(auditLog.at))
        .limit(PER_SOURCE_LIMIT),
    ]);

    return mergeLogEntries(
      activityRows.map((r) => ({
        id: `activity:${r.id}`,
        source: 'activity' as const,
        at: r.at.toISOString(),
        actorUserId: r.actorUserId,
        labelKey: r.kind,
        note: r.note,
      })),
      auditRows.map((r) => ({
        id: `audit:${r.id}`,
        source: 'audit' as const,
        at: r.at.toISOString(),
        actorUserId: r.actorUserId,
        labelKey: `${r.entity}.${r.action}`,
        note: null,
      })),
      limit,
    );
  });
}
