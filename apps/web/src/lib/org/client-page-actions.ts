'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { updateClientPageDetailsCore } from './client-page-details-core';
import type { ClientPageField } from './client-page-details';
import { schedulePaymentDetailsAlertEmails } from './payment-details-alert';

/** What the Settings card learns: the outcome and, on a refusal, its field. */
export type ClientPageDetailsSaveResult = ActionResult & { field?: ClientPageField };

/** How the alert names the member who saved: their profile name, else their email. */
function displayNameOf(user: Awaited<ReturnType<typeof getSessionUser>>): string | null {
  const metadata = user?.user_metadata as { full_name?: unknown; display_name?: unknown } | undefined;
  const name = [metadata?.full_name, metadata?.display_name].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return name?.trim() ?? user?.email ?? null;
}

/**
 * Save the studio's phone, WhatsApp and payment details (Settings, "What your
 * clients see"). Owner/admin only, gated in the core. On a payment-detail
 * change the owners' and admins' emails are started after the response. The
 * answer carries no member id and no stored value: only ok, the code and the
 * field it is about.
 */
export async function updateClientPageDetails(
  input: Record<ClientPageField, unknown>,
): Promise<ClientPageDetailsSaveResult> {
  const ctx = await requireOrg();
  const result = await updateClientPageDetailsCore(ctx, input, displayNameOf(await getSessionUser()));
  if (!result.ok) return { ok: false, error: result.error, field: result.field };
  if (result.data?.alert) await schedulePaymentDetailsAlertEmails(result.data.alert);
  revalidatePath('/', 'layout');
  return { ok: true };
}
