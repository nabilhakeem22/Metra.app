'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { addActivityCore, type AddActivityInput } from './core';

/** Add a manual note to a client's (or project's) activity feed. */
export async function addActivity(
  input: AddActivityInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await addActivityCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return { ok: res.ok, error: res.error };
}
