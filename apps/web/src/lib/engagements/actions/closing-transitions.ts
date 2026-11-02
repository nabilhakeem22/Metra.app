'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { executeTransition } from '../executor';

/**
 * Server-action wrapper for the `draftReady` transition (tail wiring):
 * shop_drawings -> boq. The `shopDrawingsPresent` guard requires at least one
 * recorded `shop_drawing` artifact. No side-effect, no payload. Revalidates the
 * shell on success — never throws to the client.
 */
export async function draftReady(engagementId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'draftReady',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `finalizeBOQ` transition (tail wiring):
 * boq -> execution_decision. The `boqPresent` guard requires a recorded `boq`
 * artifact; the trigger is finance-family (owner/admin/accountant). No
 * side-effect, no payload. Revalidates the shell on success — never throws.
 */
export async function finalizeBOQ(engagementId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'finalizeBOQ',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `chooseDesignOnly` transition (tail wiring):
 * execution_decision -> design_only_handoff. The `balanceCleared` guard requires
 * the balance installment fully paid (owner-locked: the balance gates BOTH
 * endings). No side-effect, no payload. Revalidates the shell on success.
 */
export async function chooseDesignOnly(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'chooseDesignOnly',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `chooseExecution` transition (tail wiring):
 * execution_decision -> execution (terminal). The `balanceCleared` guard
 * requires the balance installment fully paid. No side-effect, no payload.
 * Revalidates the shell on success — never throws to the client.
 */
export async function chooseExecution(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'chooseExecution',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `recipientAcknowledges` transition (tail
 * wiring): design_only_handoff -> closed_design_only (terminal). The
 * `handoffAcknowledged` guard requires one `handoff_acknowledgement` event (the
 * client's token ack OR the staff-recorded stand-in); the trigger is
 * issue-family (owner/admin, approve). Revalidates the shell on success.
 */
export async function recipientAcknowledges(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'recipientAcknowledges',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `abandon` transition (tail wiring): any
 * non-terminal state -> abandoned (terminal). Guard-less — the UI gates it
 * behind an inline confirm instead. No side-effect, no payload. Revalidates the
 * shell on success — never throws to the client.
 */
export async function abandonEngagement(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'abandon',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
