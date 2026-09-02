// PURE client cores — no next/*, no cookies. Take an OrgContext + input; the
// 'use server' wrappers in ./actions do the session/requireOrg work and delegate.
// Exercised directly by tests/actions/clients.dbtest.ts.
import { CLIENT_TYPES, clients, type ClientType } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';

export interface ClientInput {
  nameEn?: string | null;
  nameAr?: string | null;
  type?: ClientType | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  taxRegistrationNumber?: string | null;
  advancePct?: string | null;
  retentionPct?: string | null;
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
  country: 120,
  address: 300,
  taxReg: 64,
  notes: 2000,
} as const;

const PCT_RE = /^\d+(\.\d+)?$/;

/** Non-negative percentage in [0,100], normalized to a decimal string, or null. */
function normPct(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return '0';
  if (!PCT_RE.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return s;
}

type NormalizedClient = ReturnType<typeof normalized>;

function normalized(input: ClientInput) {
  return {
    nameEn: clean(input.nameEn),
    nameAr: clean(input.nameAr),
    type: input.type ?? undefined,
    contactName: clean(input.contactName),
    email: clean(input.email),
    phone: clean(input.phone),
    city: clean(input.city),
    country: clean(input.country),
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
    ok(v.country, LIMITS.country) &&
    ok(v.address, LIMITS.address) &&
    ok(v.taxRegistrationNumber, LIMITS.taxReg) &&
    ok(v.notes, LIMITS.notes)
  );
}

function validType(t: ClientType | undefined): boolean {
  return t === undefined || CLIENT_TYPES.includes(t);
}

export async function createClientCore(
  ctx: OrgContext,
  input: ClientInput,
): Promise<ActionResult & { data?: string }> {
  const v = normalized(input);
  if (!v.nameEn && !v.nameAr) return err('name_required');
  // Phone is MANDATORY (owner decision): a client record with no way to reach them
  // is not usable by a studio that runs on phone calls.
  if (!v.phone) return err('phone_required');
  if (!withinLimits(v) || !validType(v.type)) return err('invalid');
  const advancePct = normPct(input.advancePct);
  const retentionPct = normPct(input.retentionPct);
  if (advancePct === null || retentionPct === null) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'create' },
    async (tx, audit) => {
      const [row] = await tx
        .insert(clients)
        .values({ orgId: ctx.orgId, ...v, advancePct, retentionPct })
        .returning({ id: clients.id });
      await appendSystemActivity(tx, ctx, {
        entityType: 'client',
        entityId: row.id,
        kind: 'client_created',
      });
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
  // NOT the same blanket rule as create. 311 of the 315 clients already in
  // production predate this requirement, and demanding a phone before an address
  // typo can be fixed would make almost every existing record uneditable. So the
  // rule here is narrower and only ever tightens: a phone that EXISTS may not be
  // blanked (checked against the stored row inside the tx below); a record that
  // never had one stays editable.
  if (!withinLimits(v) || !validType(v.type)) return err('invalid');
  // PARTIAL UPDATE on the percentages: `undefined` means "not managed by this
  // caller", not "set to zero". The client Details form stopped editing these when
  // they moved to the Financials tab (derived from contracts), and without this an
  // ordinary profile save would silently zero two columns that Public API v1 still
  // serves. An explicit '' still normalizes to '0' — that is a real edit.
  // Phone is PARTIAL for the same reason the percentages are: an update that does
  // not mention it must not wipe it.
  const phoneOmitted = input.phone === undefined;
  const advancePct =
    input.advancePct === undefined ? undefined : normPct(input.advancePct);
  const retentionPct =
    input.retentionPct === undefined ? undefined : normPct(input.retentionPct);
  if (advancePct === null || retentionPct === null) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: clients.id, phone: clients.phone })
        .from(clients)
        .where(eq(clients.id, input.id))
        .limit(1);
      if (!before) fail('invalid');
      // Forward-only tightening, and it must distinguish OMITTED from CLEARED.
      // `normalized()` maps both `undefined` and `''` to null, so checking `v.phone`
      // alone would reject an ordinary partial save that simply did not mention the
      // phone — which is what broke the existing update test. Only an EXPLICIT blank
      // is refused.
      if (!phoneOmitted && before.phone && !v.phone) fail('phone_required');

      await tx
        .update(clients)
        .set({
          ...v,
          // An omitted phone is left exactly as it was, rather than nulled.
          ...(phoneOmitted ? { phone: before.phone } : {}),
          ...(advancePct !== undefined ? { advancePct } : {}),
          ...(retentionPct !== undefined ? { retentionPct } : {}),
          updatedAt: new Date(),
        })
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
