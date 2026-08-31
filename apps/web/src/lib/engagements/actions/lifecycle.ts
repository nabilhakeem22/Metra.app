'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  recordRomAcknowledgementCore,
  type RecordRomAcknowledgementInput,
} from '../approvals';
import { createEngagementCore, type CreateEngagementInput } from '../core';
import { executeTransition } from '../executor';
import {
  recordHandoffAcknowledgementCore,
  type RecordHandoffAcknowledgementInput,
} from '../handoff';
import {
  setEngagementOffPlanCore,
  type SetEngagementOffPlanInput,
} from '../off-plan';
import { setEngagementRomCore, type SetEngagementRomInput } from '../rom';
import type {
  GenerateFeeSchedulePayload,
  RequestRevisionPayload,
} from '../transitions';

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
 */
export async function requestRevision(
  engagementId: string,
  payload?: RequestRevisionPayload,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'requestRevision',
    payload,
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

/**
 * Server-action wrapper for the `rendersReady` transition (Step 11): design_3d ->
 * final_approval. The `rendersPresent` guard proves at least one approved render
 * exists; the `captureRenderManifest` side-effect captures the deterministic
 * baseline manifest hash and stamps `renders_ready_at`, atomically with the state
 * move. No payload. Revalidates the shell on success — never throws to the client.
 */
export async function rendersReady(engagementId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'rendersReady',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `flagAsBuiltVariance` transition (Step 13):
 * final_approval -> change_triage. Fires the executor's `recordAsBuiltVariance`
 * side-effect (one `as_built_attestation` event, has_variance=true), atomically
 * with the state move. Only admissible for an Off-Plan engagement whose as-built
 * drawings are due (`asBuiltDueOpen`); otherwise fails closed with
 * `as_built_not_due`. Revalidates the shell on success.
 */
export async function flagAsBuiltVariance(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'flagAsBuiltVariance',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `attestAsBuiltClean` transition (Step 13): a clean
 * as-built attestation targeting final_approval — the final_approval self-loop AND
 * the change_triage -> final_approval reconciliation. Fires the executor's
 * `recordAsBuiltClean` side-effect (one `as_built_attestation` event,
 * has_variance=false). Only admissible for an Off-Plan engagement whose as-built
 * drawings are due (`asBuiltDueOpen`); otherwise fails closed with
 * `as_built_not_due`. Revalidates the shell on success.
 */
export async function attestAsBuiltClean(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'attestAsBuiltClean',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `approveDesign` transition (Step 14, Gate B):
 * final_approval -> shop_drawings, closing the design phase. Runs the compound
 * guard — client ROM acknowledged, as-built reconciled (Off-Plan), Gate-B
 * installment cleared — then fires the executor's `recordDesignApproval`
 * side-effect (one `design_approval` event), atomically with the state move.
 * Revalidates the shell on success. Returns the ActionResult — never throws.
 */
export async function approveDesign(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'approveDesign',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `rejectDesign` transition (Step 14, Gate B):
 * final_approval -> negotiation. No guard — a rejection is always allowed. Fires
 * the executor's `resetRevisionsOnReject` side-effect (revision_count -> 0,
 * concept_locked_at -> null: refill free revisions + reopen the concept lock),
 * atomically with the state move. Revalidates the shell on success. Returns the
 * ActionResult — never throws.
 */
export async function rejectDesign(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'rejectDesign',
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for the `designChangeRaised` transition (the 3D revision
 * loop): final_approval / shop_drawings -> design_3d, so the studio can act on a
 * client's design-change request and RE-ISSUE a revised 3D. No guard — a revision
 * is always allowed while the design is in flight. Reuses the concept stage's
 * `applyRevision` side-effect against its OWN allowance: the 3D revision counter
 * (`design_revision_count`, independent of the concept one) increments, and once it
 * crosses the free 3D allowance a change order is raised, which REQUIRES a positive
 * `changeOrderAmount` in the payload (else the whole transition rolls back with
 * `revision_co_amount_required`). Revalidates the shell on success — never throws.
 */
export async function designChangeRaised(
  engagementId: string,
  payload?: RequestRevisionPayload,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'designChangeRaised',
    payload,
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

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
 * Server-action wrapper for {@link recordHandoffAcknowledgementCore}: resolves
 * the request's org context, appends one `handoff_acknowledgement` event (the
 * staff stand-in for the client's token ack), and revalidates the shell on
 * success. Returns the ActionResult (with the new event id in `data`) — never
 * throws to the client. This is manual-model data entry, NOT a machine
 * transition; the `recipientAcknowledges` guard reads the event it writes.
 */
export async function recordHandoffAcknowledgement(
  input: RecordHandoffAcknowledgementInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await recordHandoffAcknowledgementCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
