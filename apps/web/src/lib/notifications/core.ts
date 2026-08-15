// PURE notification cores. `insertNotification` is a helper called INSIDE an
// existing org-scoped tx (the automation runner) — it never gates (the runner
// resolved the system actor) and never audits; it IS the record. Mark-read is
// recipient-scoped by RLS, so a caller can only ever flip their own rows.
import { notifications, type MetraDb } from '@metra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import type { NotificationKind } from './kinds';

export interface NotificationInput {
  recipientUserId: string;
  kind: NotificationKind;
  entityType?: string | null;
  entityId?: string | null;
  bodyKey: string;
  params?: Record<string, unknown> | null;
}

/**
 * Insert a notification for a recipient within the caller's tx. Deliberately NO
 * `RETURNING`: the notifications SELECT policy is recipient-scoped, and
 * `INSERT ... RETURNING` re-checks the new row against that SELECT policy — which
 * would reject the runner-as-owner inserting for ANY OTHER recipient (its whole
 * job). The WITH CHECK (org + membership) still guards the write; we never read
 * the row back here.
 */
export async function insertNotification(
  tx: MetraDb,
  orgId: string,
  input: NotificationInput,
): Promise<void> {
  await tx.insert(notifications).values({
    orgId,
    recipientUserId: input.recipientUserId,
    kind: input.kind,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    bodyKey: input.bodyKey,
    params: (input.params ?? {}) as never,
  });
}

/** Mark one of the caller's notifications read (RLS scopes to the recipient). */
export async function markNotificationReadCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(ctx, {}, async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(eq(notifications.id, input.id));
  });
}

/** Mark ALL of the caller's unread notifications read. */
export async function markAllNotificationsReadCore(
  ctx: OrgContext,
): Promise<ActionResult> {
  return mutateInOrg(ctx, {}, async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, ctx.userId),
          isNull(notifications.readAt),
        ),
      );
  });
}
