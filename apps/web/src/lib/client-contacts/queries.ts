import 'server-only';
import { clientContacts, type ClientContact } from '@metra/db';
import { asc, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** A client's contacts, primary first, then by name then created. */
export function listContacts(
  ctx: OrgContext,
  clientId: string,
): Promise<ClientContact[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId))
      .orderBy(
        desc(clientContacts.isPrimary),
        asc(clientContacts.name),
        asc(clientContacts.createdAt),
      ),
  );
}
