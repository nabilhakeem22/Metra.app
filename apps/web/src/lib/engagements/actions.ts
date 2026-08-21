'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { createEngagementCore, type CreateEngagementInput } from './core';
import { executeTransition } from './executor';
import type { GenerateFeeSchedulePayload } from './transitions';

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
 * `submitDesignFee` (created -> design_proposal). Carries the fee-schedule payload
 * (design fee + milestone split) to the executor's `generateFeeSchedule`
 * side-effect, which validates it and — atomically with the state move — sets the
 * fee and writes the milestone rows. Revalidates the shell on success. The other
 * 16 triggers are declared-but-fail-closed and not exposed until their step lands.
 */
export async function submitDesignFee(
  engagementId: string,
  payload: GenerateFeeSchedulePayload,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload,
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
