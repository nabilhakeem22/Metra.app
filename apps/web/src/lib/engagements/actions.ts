'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { createEngagementCore, type CreateEngagementInput } from './core';

/**
 * Server-action wrapper for {@link createEngagementCore}: resolves the request's
 * org context, runs the core, and revalidates the app shell on success. Returns
 * the ActionResult (with the new engagement id in `data`) — never throws to the
 * client.
 */
export async function createEngagement(
  input: CreateEngagementInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await createEngagementCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
