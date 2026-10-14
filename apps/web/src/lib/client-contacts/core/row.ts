// PURE contact row actions: promote one contact to primary, delete one. Both
// gate on clients/update (manager-only, §2.2).
import { clientContacts } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

/** Atomically make one contact the client's primary (demotes the previous one). */
export async function setPrimaryContactCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const c = await requireInOrg(
        tx,
        clientContacts,
        input.id,
        { id: clientContacts.id, clientId: clientContacts.clientId },
        'invalid',
      );

      // Clear every primary for this client first, then set the target — so the
      // partial unique (one primary per client) is never violated mid-swap.
      await tx
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(clientContacts.clientId, c.clientId),
            eq(clientContacts.isPrimary, true),
          ),
        );
      await tx
        .update(clientContacts)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(clientContacts.id, input.id));
      await audit({
        entity: 'client_contact',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { is_primary: true },
      });
    },
  );
}

export async function deleteContactCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const c = await requireInOrg(
        tx,
        clientContacts,
        input.id,
        { id: clientContacts.id, isPrimary: clientContacts.isPrimary },
        'invalid',
      );
      // The primary can't be deleted out from under a client — promote another
      // contact first. Deletes nothing.
      if (c.isPrimary) fail('last_primary_contact');

      await tx.delete(clientContacts).where(eq(clientContacts.id, input.id));
      await audit({
        entity: 'client_contact',
        entityId: input.id,
        action: 'delete',
        before: null,
        after: null,
      });
    },
  );
}
