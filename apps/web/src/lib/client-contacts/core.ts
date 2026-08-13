// PURE client-contact cores. Contacts belong to a client (same org). At most one
// primary per client (DB partial unique). Writes gate on the clients capability:
// create->clients/create, edits->clients/update (manager-only, §2.2).
import { clientContacts, clients } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITS = {
  name: 200,
  role: 120,
  phone: 40,
  email: 254,
  whatsapp: 40,
} as const;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

export interface ContactInput {
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  isPrimary?: boolean;
}

function normalized(input: ContactInput) {
  return {
    name: clean(input.name),
    role: clean(input.role),
    phone: clean(input.phone),
    email: clean(input.email),
    whatsapp: clean(input.whatsapp),
  };
}

function withinLimits(v: ReturnType<typeof normalized>): boolean {
  const ok = (s: string | null, max: number) => (s?.length ?? 0) <= max;
  return (
    ok(v.name, LIMITS.name) &&
    ok(v.role, LIMITS.role) &&
    ok(v.phone, LIMITS.phone) &&
    ok(v.email, LIMITS.email) &&
    ok(v.whatsapp, LIMITS.whatsapp)
  );
}

export async function createContactCore(
  ctx: OrgContext,
  input: { clientId: string } & ContactInput,
): Promise<ActionResult & { data?: string }> {
  if (!UUID_RE.test(input.clientId ?? '')) return err('invalid');
  const v = normalized(input);
  const name = v.name;
  if (!name) return err('name_required');
  if (!withinLimits(v)) return err('invalid');
  const makePrimary = input.isPrimary === true;

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'create' },
    async (tx, audit) => {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, input.clientId))
        .limit(1);
      if (!client) fail('invalid');

      // A new primary demotes any existing primary first (avoids two-primary).
      if (makePrimary) {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(clientContacts.clientId, input.clientId),
              eq(clientContacts.isPrimary, true),
            ),
          );
      }

      const [row] = await tx
        .insert(clientContacts)
        .values({
          orgId: ctx.orgId,
          clientId: input.clientId,
          name,
          role: v.role,
          phone: v.phone,
          email: v.email,
          whatsapp: v.whatsapp,
          isPrimary: makePrimary,
        })
        .returning({ id: clientContacts.id });
      await audit({
        entity: 'client_contact',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { client_id: input.clientId, name },
      });
      return row.id;
    },
  );
}

export async function updateContactCore(
  ctx: OrgContext,
  input: { id: string } & ContactInput,
): Promise<ActionResult> {
  const v = normalized(input);
  const name = v.name;
  if (!name) return err('name_required');
  if (!withinLimits(v)) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      // is_primary is NOT touched here — use setPrimaryContactCore for that.
      await tx
        .update(clientContacts)
        .set({
          name,
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
        after: { name },
      });
    },
  );
}

/** Atomically make one contact the client's primary (demotes the previous one). */
export async function setPrimaryContactCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const [c] = await tx
        .select({ id: clientContacts.id, clientId: clientContacts.clientId })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!c) fail('invalid');

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
      const [c] = await tx
        .select({ id: clientContacts.id, isPrimary: clientContacts.isPrimary })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.id))
        .limit(1);
      if (!c) fail('invalid');
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
