'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { actorIdentityOf } from '@/lib/team/actor-identity';
import { scheduleClientPageAlertEmails } from './client-page-alert-email';
import { updateClientPageDetailsCore, type ClientPageDetailsSave } from './client-page-details-core';
import type { ClientPageField } from './client-page-details';

/** What the Settings card learns: the outcome and, on a refusal, its field. */
export type ClientPageDetailsSaveResult = ActionResult & { field?: ClientPageField };

/**
 * Save the studio's phone, WhatsApp and payment details (Settings, "What your
 * clients see"): only the fields the sheet changed, against the revision it
 * loaded. Owner/admin only, gated in the core. When the change alerts by email,
 * the emails start after the response and name the saver by their auth
 * session's verified email. The answer carries no member id and no stored
 * value: only ok, the code and the field it is about.
 */
export async function updateClientPageDetails(input: ClientPageDetailsSave): Promise<ClientPageDetailsSaveResult> {
  const ctx = await requireOrg();
  const result = await updateClientPageDetailsCore(ctx, input);
  if (!result.ok) return { ok: false, error: result.error, field: result.field };
  if (result.data?.alert) {
    await scheduleClientPageAlertEmails(result.data.alert, actorIdentityOf(await getSessionUser()));
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
