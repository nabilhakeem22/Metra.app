// PURE contact write cores: add one contact to a client, edit one. Contacts
// belong to a client (same org); create gates on clients/create, the edit on
// clients/update (manager-only, §2.2).
import { clientContacts, clients } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { readContactInput } from '../field-rules';
import type { ContactInput } from '../fields';
import { insertClientContactInTx } from '../insert';

export async function createContactCore(
  ctx: OrgContext,
  input: { clientId: string } & ContactInput,
): Promise<ActionResult & { data?: string }> {
  if (!isUuid(input.clientId)) return err('malformed');
  const read = readContactInput(input);
  if (!read.ok) return fieldsFailed(read.errors);
  const v = read.values;
  const makePrimary = input.isPrimary === true;

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'create' },
    async (tx, audit) => {
      // An existence assertion, not a read: the call IS the check, and it
      // fails with a coded error for an id that is absent or another tenant's.
      await requireInOrg(tx, clients, input.clientId, { id: clients.id }, 'record_not_found');

      return insertClientContactInTx(tx, ctx, audit, {
        clientId: input.clientId,
        name: v.name,
        role: v.role,
        phone: v.phone,
        email: v.email,
        whatsapp: v.whatsapp,
        isPrimary: makePrimary,
      });
    },
  );
}

export async function updateContactCore(
  ctx: OrgContext,
  input: { id: string } & ContactInput,
): Promise<ActionResult> {
  const read = readContactInput(input);
  if (!read.ok) return fieldsFailed(read.errors);
  const v = read.values;

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      // An existence assertion, not a read: the call IS the check, and it
      // fails with a coded error for an id that is absent or another tenant's.
      await requireInOrg(tx, clientContacts, input.id, { id: clientContacts.id }, 'record_not_found');

      // is_primary is NOT touched here — use setPrimaryContactCore for that.
      await tx
        .update(clientContacts)
        .set({
          name: v.name,
          role: v.role,
          phone: v.phone,
          email: v.email,
          whatsapp: v.whatsapp,
          updatedAt: new Date(),
        })
        .where(eq(clientContacts.id, input.id));
      await audit({
        entity: 'client_contact',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { name: v.name },
      });
    },
  );
}
