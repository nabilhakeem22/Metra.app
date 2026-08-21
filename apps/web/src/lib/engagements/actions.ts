'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { createEngagementCore, type CreateEngagementInput } from './core';
import { executeTransition } from './executor';

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

/**
 * Server-action wrapper for the one fully-wired transition this step:
 * `submitDesignFee` (created -> design_proposal). Resolves the org context, runs
 * the executor, revalidates the shell on success. The other 16 triggers are
 * declared-but-fail-closed and are not exposed as actions until their step lands.
 */
export async function submitDesignFee(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
