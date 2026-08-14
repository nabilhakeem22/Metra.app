'use server';

import { revalidatePath } from 'next/cache';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { canManageOrg } from '@/lib/permissions/can';
import {
  updateAutomationSettingsCore,
  type AutomationSettingsInput,
} from './settings-core';

export type { AutomationSettingsInput };

/** Owner/admin-only edit of the org's automation settings. */
export async function updateAutomationSettings(
  input: AutomationSettingsInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');

  const res = await updateAutomationSettingsCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
