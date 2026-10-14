// PURE client create core — no next/*, no cookies. The 'use server' wrapper in
// ../actions does the session/requireOrg work and delegates.
import { clients } from '@metra/db';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';
import { insertClientContactInTx } from '@/lib/client-contacts/insert';
import { readClientInput } from '../field-rules';
import type { ClientInput } from '../fields';
import { CLIENT_PERCENT_REFUSALS, isClientType } from './shared';

export async function createClientCore(
  ctx: OrgContext,
  input: ClientInput,
): Promise<ActionResult & { data?: string }> {
  if (!isClientType(input.type)) return err('malformed');
  // Phone is MANDATORY (owner decision): a client record with no way to reach them
  // is not usable by a studio that runs on phone calls.
  const read = readClientInput(input, { phoneRequired: true });
  if (!read.ok) return fieldsFailed(read.errors);
  // A percentage the caller did not send starts at zero.
  const { advancePct = '0', retentionPct = '0', ...v } = read.values;

  return mutateInOrg(
    ctx,
    { capability: 'clients', action: 'create', refusals: CLIENT_PERCENT_REFUSALS },
    async (tx, audit) => {
      const [row] = await tx
        .insert(clients)
        .values({ orgId: ctx.orgId, ...v, advancePct, retentionPct })
        .returning({ id: clients.id });
      // The contact typed on the client form is ALSO the client's first contact,
      // in the same transaction (the contact limits equal the client's, so this
      // adds no new failure). The client row keeps its own copy as before.
      if (v.contactName) {
        await insertClientContactInTx(tx, ctx, audit, {
          clientId: row.id,
          name: v.contactName,
          role: null,
          phone: v.phone,
          email: v.email,
          whatsapp: null,
          isPrimary: true,
        });
      }
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
