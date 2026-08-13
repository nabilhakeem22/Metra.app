import 'server-only';
import {
  activities,
  type Activity,
  type ActivityEntityType,
} from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** An entity's activity feed, newest first. */
export function listActivities(
  ctx: OrgContext,
  entityType: ActivityEntityType,
  entityId: string,
  limit = 50,
): Promise<Activity[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.entityType, entityType),
          eq(activities.entityId, entityId),
        ),
      )
      .orderBy(desc(activities.createdAt))
      .limit(limit),
  );
}
