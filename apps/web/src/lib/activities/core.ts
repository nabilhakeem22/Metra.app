// PURE activity cores. `appendSystemActivity` is a helper called INSIDE an
// existing mutate transaction (create client / send proposal / accept proposal)
// so the event is written atomically with the thing it records. `addActivityCore`
// (manual notes) is added alongside. No next/*, no cookies.
import {
  activities,
  clients,
  projects,
  type ActivityEntityType,
  type ActivityKind,
  type MetraDb,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 4000;

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

export interface AddActivityInput {
  entityType: ActivityEntityType;
  entityId: string;
  kind?: ActivityKind;
  note?: string | null;
}

/**
 * Manual activity (a note) on a client (or project, provisioned). Gated by the
 * matrix `client_activity` capability. A note MUST carry text. The parent entity
 * MUST exist in-org (RLS-scoped load) — else `invalid`, so a caller can't spray
 * activities at arbitrary/foreign ids. actorUserId = ctx.userId.
 */
export async function addActivityCore(
  ctx: OrgContext,
  input: AddActivityInput,
): Promise<ActionResult & { data?: string }> {
  if (!UUID_RE.test(input.entityId ?? '')) return err('invalid');
  const kind = input.kind ?? 'note';
  const note = input.note?.trim() || null;
  if (kind === 'note' && !note) return err('invalid');
  if ((note?.length ?? 0) > NOTE_MAX) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'client_activity', action: 'create' },
    async (tx, audit) => {
      // The parent entity must be in THIS org (RLS-scoped).
      const parentTable =
        input.entityType === 'client' ? clients : projects;
      const [parent] = await tx
        .select({ id: parentTable.id })
        .from(parentTable)
        .where(eq(parentTable.id, input.entityId))
        .limit(1);
      if (!parent) fail('invalid');

      const [row] = await tx
        .insert(activities)
        .values({
          orgId: ctx.orgId,
          entityType: input.entityType,
          entityId: input.entityId,
          actorUserId: ctx.userId ?? null,
          kind,
          note,
          meta: null,
        })
        .returning({ id: activities.id });
      await audit({
        entity: 'activity',
        entityId: row.id,
        action: 'create',
        before: null,
        after: {
          entity_type: input.entityType,
          entity_id: input.entityId,
          kind,
        },
      });
      return row.id;
    },
  );
}
