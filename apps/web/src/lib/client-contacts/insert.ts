// Insert one client contact INSIDE the caller's transaction: demote any existing
// primary when the new one is primary (at most one per client, DB partial
// unique), insert, audit. Extracted verbatim from `createContactCore` so the
// client create can write the client's first contact in the SAME transaction.
// The caller has already validated the row and asserted the client is in-org.
import { clientContacts, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';

export interface ClientContactRow {
  clientId: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
}

/** Returns the new contact's id. */
export async function insertClientContactInTx(
  tx: MetraDb,
  ctx: OrgContext,
  audit: (entry: AuditEntry) => Promise<void>,
  row: ClientContactRow,
): Promise<string> {
  // A new primary demotes any existing primary first (avoids two-primary).
  if (row.isPrimary) {
    await tx
      .update(clientContacts)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(eq(clientContacts.clientId, row.clientId), eq(clientContacts.isPrimary, true)));
  }

  const [inserted] = await tx
    .insert(clientContacts)
    .values({
      orgId: ctx.orgId,
      clientId: row.clientId,
      name: row.name,
      role: row.role,
      phone: row.phone,
      email: row.email,
      whatsapp: row.whatsapp,
      isPrimary: row.isPrimary,
    })
    .returning({ id: clientContacts.id });
  await audit({
    entity: 'client_contact',
    entityId: inserted.id,
    action: 'create',
    before: null,
    after: { client_id: row.clientId, name: row.name },
  });
  return inserted.id;
}
