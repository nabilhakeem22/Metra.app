'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { executeTransition } from '../executor';
import type { GenerateFeeSchedulePayload, RequestRevisionPayload } from '../transitions';

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
 * Server-action wrapper for the `confirmAndPayDeposit` transition (Step 4):
 * design_proposal -> survey. The `depositCleared` guard reads the payment ledger;
 * the `activateOnDeposit` side-effect runs atomically with the state move. No
 * payload. Revalidates the shell on success — never throws to the client.
 */
export async function confirmAndPayDeposit(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'confirmAndPayDeposit',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `spatialBaseReady` transition (Step 5): survey ->
 * layout. The `spatialBaseReady` guard reads the recorded artifacts (a survey, or
 * a developer CAD set for off-plan). No side-effect, no payload. Revalidates the
 * shell on success — never throws to the client.
 */
export async function spatialBaseReady(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'spatialBaseReady',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `optionsReady` transition (Step 6): layout ->
 * concept_review. The `optionsReady` guard reads the recorded concept-option
 * artifacts (2–4). No side-effect, no payload. Revalidates the shell on success —
 * never throws to the client.
 */
export async function optionsReady(engagementId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'optionsReady',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `selectConcept` transition (Step 7): concept_review
 * -> negotiation. The `gateAInstallmentCleared` guard reads the payment ledger; the
 * `recordConceptApproval` side-effect appends one `concept_approval` event,
 * atomically with the state move. No payload. Revalidates the shell on success —
 * never throws to the client.
 */
export async function selectConcept(engagementId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'selectConcept',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `requestRevision` self-loop (Step 8): negotiation
 * -> negotiation. Always allowed (no guard). The `applyRevision` side-effect
 * increments the CONCEPT revision counter and — once it crosses the free concept
 * allowance — raises a design-fee change order (the 3D allowance is a separate
 * pair and is never touched here), which REQUIRES a positive `changeOrderAmount`
 * in the payload (else the whole transition rolls back with
 * `revision_co_amount_required`). Revalidates the shell on success — never throws.
 *
 * SELF-LOOP, so it carries an `idempotencyKey` (0050): negotiation -> negotiation
 * leaves nothing for a state gate to catch, and a retry after a lost response
 * would spend a second free revision — or raise a second change order — for one
 * request.
 */
export async function requestRevision(
  engagementId: string,
  payload?: RequestRevisionPayload,
  idempotencyKey?: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'requestRevision',
    payload,
    idempotencyKey,
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `confirmConcept` transition (Step 9): negotiation
 * -> design_3d. The `revisionCosSettled` guard requires every over-allowance
 * revision change order to be covered by cleared revision_co payments; the
 * `settleConceptAndLock` side-effect settles those COs and stamps
 * `concept_locked_at`, atomically with the state move. No payload. Revalidates the
 * shell on success — never throws to the client.
 */
export async function confirmConcept(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'confirmConcept',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
