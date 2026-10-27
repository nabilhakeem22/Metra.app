'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { recordEventCorrectionCore, type RecordEventCorrectionInput } from '../corrections';
import {
  recordRomAcknowledgementCore,
  type RecordRomAcknowledgementInput,
} from '../rom-acknowledgement';
import { createEngagementCore, type CreateEngagementInput } from '../core';
import {
  setEngagementOffPlanCore,
  type SetEngagementOffPlanInput,
} from '../off-plan';

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
 * Server-action wrapper for {@link setEngagementOffPlanCore}: resolves the
 * request's org context, flips the engagement's off-plan flag (existing unit vs
 * off-plan / developer shell), and revalidates the shell on success. Returns the
 * ActionResult — never throws to the client. Plain data entry, NOT a machine
 * transition; the survey-vs-CAD branch (Step 2) reads the flag it writes.
 */
export async function setEngagementOffPlan(
  input: SetEngagementOffPlanInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setEngagementOffPlanCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link recordRomAcknowledgementCore}: resolves the
 * request's org context, appends one client ROM-acknowledgement to the append-only
 * approvals ledger (snapshotting the engagement's current ROM band), and
 * revalidates the shell on success. Returns the ActionResult (with the new event id
 * in `data`) — never throws to the client. This is manual-model data entry, NOT a
 * machine transition; Gate B's later guard reads the event it writes.
 */
export async function recordRomAcknowledgement(
  input: RecordRomAcknowledgementInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await recordRomAcknowledgementCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link recordEventCorrectionCore}: retracts one row
 * from the append-only approvals ledger by appending an `event_correction` that
 * points at it.
 *
 * Nothing is deleted or edited -- the grants forbid both, and that is the point.
 * The retracted row stays visible beside its retraction, and `liveEvents` stops
 * the guards counting it, so a withdrawn acknowledgement stops opening its gate.
 * Owner and admin only. Never throws to the client.
 */
export async function recordEventCorrection(
  input: RecordEventCorrectionInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await recordEventCorrectionCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
