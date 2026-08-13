// PURE activity cores. `appendSystemActivity` is a helper called INSIDE an
// existing mutate transaction (create client / send proposal / accept proposal)
// so the event is written atomically with the thing it records. `addActivityCore`
// (manual notes) is added alongside. No next/*, no cookies.
import { activities, type ActivityEntityType, type MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';

export interface SystemActivityInput {
  entityType: ActivityEntityType;
  entityId: string;
  kind: 'client_created' | 'proposal_sent' | 'proposal_accepted';
  meta?: Record<string, unknown> | null;
}

/**
 * Append a system activity within the caller's transaction. Never gates (the
 * parent mutation already did) and never audits — it IS the record. actorUserId
 * comes from ctx (null for the unauthenticated accept path if ctx.userId absent).
 */
export async function appendSystemActivity(
  tx: MetraDb,
  ctx: Pick<OrgContext, 'orgId' | 'userId'>,
  input: SystemActivityInput,
): Promise<void> {
  await tx.insert(activities).values({
    orgId: ctx.orgId,
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: ctx.userId ?? null,
    kind: input.kind,
    note: null,
    meta: (input.meta ?? null) as never,
  });
}
