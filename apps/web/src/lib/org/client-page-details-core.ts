// The studio's client page details, saved (Round C, C8). One owner/admin write
// of the seven `organizations` columns 0058 added, with a MASKED audit row and,
// when a payment detail changed, an in-app alert to every owner and admin (owner
// decision, Oct 10). The alert's emails are sent by the caller after the commit
// (./payment-details-alert.ts), so a slow mail provider never holds the row.
import { organizations, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { isOwnerOnlyColumnViolation } from '@/lib/actions/db-conflict';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { orgOwnerAdminIds } from '@/lib/automation/due-work';
import type { OrgContext } from '@/lib/db/context';
import { insertNotifications } from '@/lib/notifications/core';
import { changedFields, changedPaymentFields, maskedChange } from './client-page-change';
import {
  normalizeClientPageDetails,
  type ClientPageDetails,
  type ClientPageField,
} from './client-page-details';

/** Who changed the payment details, whom to tell, and in which language. */
export interface PaymentDetailsAlert {
  recipientUserIds: string[];
  changedBy: string | null;
  fields: ClientPageField[];
  /** The studio's default locale: the language of the alert emails. */
  locale: string;
}

export type ClientPageDetailsResult = ActionResult & {
  /** The field a refusal is about, so the card can say it under that field. */
  field?: ClientPageField;
  /** Set when a payment detail changed: the caller emails these people. */
  data?: { alert: PaymentDetailsAlert | null };
};

/** The seven columns as they are now, locked so two saves audit in order. */
async function storedDetails(tx: MetraDb, orgId: string) {
  const [row] = await tx
    .select({
      studioPhone: organizations.studioPhone,
      studioWhatsapp: organizations.studioWhatsapp,
      instapayAddress: organizations.instapayAddress,
      bankName: organizations.bankName,
      bankAccountHolder: organizations.bankAccountHolder,
      bankAccountNumber: organizations.bankAccountNumber,
      bankIban: organizations.bankIban,
      defaultLocale: organizations.defaultLocale,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .for('update');
  if (!row) fail('generic');
  const { defaultLocale, ...details } = row;
  return { details: details satisfies ClientPageDetails, locale: defaultLocale };
}

/** The UPDATE; the database's own owner/admin gate (MT120) answers with a code. */
async function writeDetails(tx: MetraDb, orgId: string, details: ClientPageDetails): Promise<void> {
  try {
    await tx
      .update(organizations)
      .set({ ...details, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
  } catch (e) {
    if (isOwnerOnlyColumnViolation(e)) fail('client_page_details_owner_only');
    throw e;
  }
}

/**
 * Save what the client page shows about the studio. Owner/admin only
 * (`users_settings` update, refused before any transaction opens; MT120 is the
 * database's second word on it). The input is normalised first and a refusal
 * names its field. Saving what is already stored writes nothing. A change is
 * audited with every number masked; a change to a PAYMENT field also notifies
 * every owner and admin in the app, and returns them as `data.alert` for the
 * caller's emails. `changedBy` is the actor's display name, resolved by the
 * caller from the session (never from request input).
 */
export async function updateClientPageDetailsCore(
  ctx: OrgContext,
  input: Record<ClientPageField, unknown>,
  changedBy: string | null,
): Promise<ClientPageDetailsResult> {
  // A server action is directly invokable: its argument may be anything.
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'invalid' };
  const normalized = normalizeClientPageDetails(input);
  if (!normalized.ok) return { ok: false, error: normalized.code, field: normalized.field };
  const next = normalized.value;

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit): Promise<{ alert: PaymentDetailsAlert | null }> => {
      const stored = await storedDetails(tx, ctx.orgId);
      const fields = changedFields(stored.details, next);
      if (fields.length === 0) return { alert: null };

      await writeDetails(tx, ctx.orgId, next);
      await audit({
        entity: 'organization',
        entityId: ctx.orgId,
        action: 'update',
        ...maskedChange(stored.details, next, fields),
      });

      const paymentFields = changedPaymentFields(fields);
      if (paymentFields.length === 0) return { alert: null };
      const recipients = (await orgOwnerAdminIds(tx)).map((member) => member.userId);
      await insertNotifications(
        tx,
        ctx.orgId,
        recipients.map((recipientUserId) => ({
          recipientUserId,
          kind: 'payment_details_changed',
          entityType: 'organization',
          entityId: ctx.orgId,
          bodyKey: 'payment_details_changed',
          params: { changedBy, fields: paymentFields },
        })),
      );
      return { alert: { recipientUserIds: recipients, changedBy, fields: paymentFields, locale: stored.locale } };
    },
  );
}
