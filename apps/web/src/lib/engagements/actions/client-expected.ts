'use server';

// The client's expected date for the next step (Round C, C8): plain data
// entry on one delivery, not a machine transition.

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { setClientExpectedDateCore, type SetClientExpectedDateInput } from '../client-expected';

/**
 * Server-action wrapper for {@link setClientExpectedDateCore}: set or clear
 * the date the client page shows for the next step, then revalidate the shell.
 * Returns the ActionResult; never throws to the client.
 */
export async function setClientExpectedDate(input: SetClientExpectedDateInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setClientExpectedDateCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
