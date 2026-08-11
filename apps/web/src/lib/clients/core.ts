// PURE client cores — no next/*, no cookies. Take an OrgContext + input; the
// 'use server' wrappers in ./actions do the session/requireOrg work and delegate.
// Exercised directly by tests/actions/clients.dbtest.ts.
import { clients } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export interface ClientInput {
  nameEn?: string | null;
  nameAr?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  taxRegistrationNumber?: string | null;
  notes?: string | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

// Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits.
const LIMITS = {
  name: 200,
  contactName: 200,
  email: 254,
  phone: 40,
  city: 120,
  address: 300,
  taxReg: 64,
  notes: 2000,
} as const;

type NormalizedClient = ReturnType<typeof normalized>;

function normalized(input: ClientInput) {
  return {
    nameEn: clean(input.nameEn),
    nameAr: clean(input.nameAr),
    contactName: clean(input.contactName),
    email: clean(input.email),
    phone: clean(input.phone),
    city: clean(input.city),
    address: clean(input.address),
    taxRegistrationNumber: clean(input.taxRegistrationNumber),
    notes: clean(input.notes),
  };
}

function withinLimits(v: NormalizedClient): boolean {
  const ok = (s: string | null, max: number) => (s?.length ?? 0) <= max;
  return (
    ok(v.nameEn, LIMITS.name) &&
    ok(v.nameAr, LIMITS.name) &&
    ok(v.contactName, LIMITS.contactName) &&
    ok(v.email, LIMITS.email) &&
    ok(v.phone, LIMITS.phone) &&
    ok(v.city, LIMITS.city) &&
    ok(v.address, LIMITS.address) &&
    ok(v.taxRegistrationNumber, LIMITS.taxReg) &&
    ok(v.notes, LIMITS.notes)
  );
}

export async function createClientCore(
  ctx: OrgContext,
  input: ClientInput,
): Promise<ActionResult> {
  const v = normalized(input);
  if (!v.nameEn && !v.nameAr) return err('name_required');
  if (!withinLimits(v)) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'create' },
    async (tx, audit) => {
      const [row] = await tx
        .insert(clients)
        .values({ orgId: ctx.orgId, ...v })
        .returning({ id: clients.id });
      await audit({
        entity: 'client',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { name_en: v.nameEn, name_ar: v.nameAr },
      });
      return row.id;
    },
  );
}

export async function updateClientCore(
  ctx: OrgContext,
  input: { id: string } & ClientInput,
): Promise<ActionResult> {
  const v = normalized(input);
  if (!v.nameEn && !v.nameAr) return err('name_required');
  if (!withinLimits(v)) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      await tx
        .update(clients)
        .set({ ...v, updatedAt: new Date() })
        .where(eq(clients.id, input.id));
      await audit({
        entity: 'client',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { name_en: v.nameEn, name_ar: v.nameAr },
      });
    },
  );
}

export async function setClientActiveCore(
  ctx: OrgContext,
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: clients.id, active: clients.active })
        .from(clients)
        .where(eq(clients.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      await tx
        .update(clients)
        .set({ active: input.active, updatedAt: new Date() })
        .where(eq(clients.id, input.id));
      await audit({
        entity: 'client',
        entityId: input.id,
        action: 'update',
        before: { active: before.active },
        after: { active: input.active },
      });
    },
  );
}
