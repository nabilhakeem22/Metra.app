// The studio's client page details, saved (Round C, C8). One owner/admin write
// of the seven `organizations` columns 0058 added, with a MASKED, fingerprinted
// audit row and an alert to every owner and admin (owner decisions, Oct 10:
// bank, InstaPay, phone and WhatsApp alike). The alert's emails are sent by the
// caller after the commit (./client-page-alert-email.ts), so a slow mail provider
// never holds the row.
import { organizations, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { isOwnerOnlyColumnViolation } from '@/lib/actions/db-conflict';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { invariant } from '@/lib/actions/invariant';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { orgOwnerAdminIds } from '@/lib/automation/due-work';
import type { OrgContext } from '@/lib/db/context';
import { insertNotifications } from '@/lib/notifications/core';
import { auditFingerprint } from './audit-fingerprint';
import { claimAlertEmail } from './client-page-alert';
import { changedFields, maskedChange } from './client-page-change';
import {
  detailsAfter,
  normalizeClientPageChanges,
  type ClientPageDetails,
  type ClientPageField,
} from './client-page-details';
import { clientPageRevision } from './client-page-revision';

/** Whom to email about a change, and in which language. */
export interface ClientPageAlert {
  recipientUserIds: string[];
  fields: ClientPageField[];
  /** The studio's default locale: the language of the alert emails. */
  locale: string;
}

/** A save: the revision the sheet loaded, and only the fields it changed. */
export interface ClientPageDetailsSave {
  revision: string;
  /** A missing key is unchanged; null (or blank) clears the field. */
  changes: Partial<Record<ClientPageField, string | null>>;
}

export type ClientPageDetailsResult = ActionResult & {
  /** Set when the change should be emailed: the caller emails these people. */
  data?: { alert: ClientPageAlert | null };
};

/** The seven columns as they are now, locked so two saves audit in order. FOR NO
 *  KEY UPDATE (Round E R2): unlike FOR UPDATE it does not conflict with the FOR
 *  KEY SHARE each client act's org_id foreign key takes, so no save holds them. */
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
    .for('no key update');
  // The org is the caller's own (the RLS context was opened for it).
  invariant(row, 'client page details: the org row is not visible');
  const { defaultLocale, ...details } = row;
  return { details: details satisfies ClientPageDetails, locale: defaultLocale };
}

/** The UPDATE of the changed columns; the database's owner/admin gate (MT120) answers with a code. */
async function writeDetails(tx: MetraDb, orgId: string, changes: Partial<ClientPageDetails>): Promise<void> {
  try {
    await tx.update(organizations).set({ ...changes, updatedAt: new Date() }).where(eq(organizations.id, orgId));
  } catch (e) {
    if (isOwnerOnlyColumnViolation(e)) fail('client_page_details_owner_only');
    throw e;
  }
}

/**
 * Notify every owner and admin in the app, EVERY time, naming every field this
 * save changed (owner rule); then say whom to email, when the email limits allow.
 */
async function alertOwners(
  tx: MetraDb,
  ctx: OrgContext,
  fields: ClientPageField[],
  locale: string,
  now: Date,
): Promise<ClientPageAlert | null> {
  const recipients = (await orgOwnerAdminIds(tx)).map((member) => member.userId);
  await insertNotifications(
    tx,
    ctx.orgId,
    recipients.map((recipientUserId) => ({
      recipientUserId,
      kind: 'client_page_details_changed',
      entityType: 'organization',
      entityId: ctx.orgId,
      bodyKey: 'client_page_details_changed',
      // The actor's ID, never a name: the feed resolves who it is when shown.
      params: { actorUserId: ctx.userId, fields },
    })),
  );
  const email = await claimAlertEmail(tx, ctx.orgId, ctx.userId, fields, now);
  return email ? { recipientUserIds: recipients, fields, locale } : null;
}

/**
 * Save what the client page shows about the studio. Owner/admin only
 * (`users_settings` update, refused before any transaction opens; MT120 is the
 * database's second word on it). Only the sent fields change, and only when
 * the stored values still match the `revision` the sheet loaded (else
 * `client_page_details_stale`). Every refused field is named at once. Saving what is
 * already stored writes nothing. A change is audited masked and fingerprinted
 * and alerts every owner and admin; `data.alert` lists whom to email.
 */
export async function updateClientPageDetailsCore(
  ctx: OrgContext,
  input: unknown,
  now: Date = new Date(),
): Promise<ClientPageDetailsResult> {
  // A server action is directly invokable: its argument may be anything.
  const save = (typeof input === 'object' && input !== null ? input : {}) as Partial<ClientPageDetailsSave>;
  if (typeof save.revision !== 'string') return err('malformed');
  const normalized = normalizeClientPageChanges(save.changes);
  if (!normalized.ok) return 'errors' in normalized ? fieldsFailed(normalized.errors) : err('malformed');

  return mutateInOrg(
    ctx,
    { capability: 'users_settings', action: 'update' },
    async (tx, audit): Promise<{ alert: ClientPageAlert | null }> => {
      const stored = await storedDetails(tx, ctx.orgId);
      if (clientPageRevision(stored.details) !== save.revision) fail('client_page_details_stale');
      const after = detailsAfter(stored.details, normalized.value);
      if (!after.ok) failFields(after.errors);
      const fields = changedFields(stored.details, after.value);
      if (fields.length === 0) return { alert: null };

      await writeDetails(tx, ctx.orgId, Object.fromEntries(fields.map((field) => [field, after.value[field]])));
      await audit({
        entity: 'organization',
        entityId: ctx.orgId,
        action: 'update',
        ...maskedChange(stored.details, after.value, fields, auditFingerprint()),
      });
      return { alert: await alertOwners(tx, ctx, fields, stored.locale, now) };
    },
  );
}
