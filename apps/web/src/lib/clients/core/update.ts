// PURE client update cores: updateClientCore (the profile edit) and
// setClientActiveCore (archive/restore).
import { clients } from '@metra/db';
import { eq } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { readClientInput } from '../field-rules';
import type { ClientInput } from '../fields';
import { CLIENT_PERCENT_REFUSALS, isClientType } from './shared';

export async function updateClientCore(
  ctx: OrgContext,
  input: { id: string } & ClientInput,
): Promise<ActionResult> {
  if (!isClientType(input.type)) return err('malformed');
  // NOT the same blanket rule as create. 311 of the 315 clients already in
  // production predate this requirement, and demanding a phone before an address
  // typo can be fixed would make almost every existing record uneditable. So the
  // rule here is narrower and only ever tightens: a phone that EXISTS may not be
  // blanked (checked against the stored row inside the tx below); a record that
  // never had one stays editable.
  const read = readClientInput(input, { phoneRequired: false });
  if (!read.ok) return fieldsFailed(read.errors);
  // PARTIAL UPDATE on the percentages: `undefined` means "not managed by this
  // caller", not "set to zero". The client Details form stopped editing these when
  // they moved to the Financials tab (derived from contracts), and without this an
  // ordinary profile save would silently zero two columns that Public API v1 still
  // serves. An explicit '' still normalizes to '0' — that is a real edit.
  // Phone is PARTIAL for the same reason the percentages are: an update that does
  // not mention it must not wipe it.
  const { advancePct, retentionPct, ...v } = read.values;
  const phoneOmitted = input.phone === undefined;

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'update', refusals: CLIENT_PERCENT_REFUSALS },
    async (tx, audit) => {
      const before = await requireInOrg(
        tx,
        clients,
        input.id,
        { id: clients.id, phone: clients.phone },
        'invalid',
      );
      // Forward-only tightening, and it must distinguish OMITTED from CLEARED.
      // `normalizedClient()` maps both `undefined` and `''` to null, so checking
      // `v.phone` alone would reject an ordinary partial save that simply did not
      // mention the phone. Only an EXPLICIT blank is refused.
      if (!phoneOmitted && before.phone && !v.phone) {
        failFields({ phone: { code: 'phone_required' } });
      }

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
      const before = await requireInOrg(
        tx,
        clients,
        input.id,
        { id: clients.id, active: clients.active },
        'invalid',
      );

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
