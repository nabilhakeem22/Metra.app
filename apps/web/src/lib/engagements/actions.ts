'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { recordArtifactCore, type RecordArtifactInput } from './artifacts';
import { createEngagementCore, type CreateEngagementInput } from './core';
import { executeTransition } from './executor';
import { recordPaymentCore, type RecordPaymentInput } from './payments';
import { setEngagementRomCore, type SetEngagementRomInput } from './rom';
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

/**
 * Server-action wrapper for {@link recordPaymentCore}: resolves the request's org
 * context, appends one cleared payment to the append-only ledger, and revalidates
 * the shell on success. Returns the ActionResult (with the new payment id in
 * `data`) — never throws to the client. This is the manual finance ledger; there
 * is no gateway.
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await recordPaymentCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link recordArtifactCore}: resolves the request's
 * org context, records (and thereby attests) one engagement artifact, and
 * revalidates the shell on success. Returns the ActionResult (with the new
 * artifact id in `data`) — never throws to the client. The artifact is the stored
 * spatial base that the `spatialBaseReady` guard reads to admit survey -> layout.
 */
export async function recordArtifact(
  input: RecordArtifactInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await recordArtifactCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link setEngagementRomCore}: resolves the request's
 * org context, writes the coarse build-cost band (ROM low/high), and revalidates
 * the shell on success. Returns the ActionResult — never throws to the client.
 * This is plain data entry, NOT a machine transition: it moves no state.
 */
export async function setEngagementRom(
  input: SetEngagementRomInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setEngagementRomCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
