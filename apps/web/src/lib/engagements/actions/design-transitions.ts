'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { executeTransition } from '../executor';
import type { RequestRevisionPayload } from '../transitions';

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
 *
 * The final_approval -> final_approval edge is a SELF-LOOP, so THIS is the one
 * that carries an `idempotencyKey` (0050): a retry after a lost response would
 * otherwise append a second attestation to an INSERT-only ledger, which cannot
 * be taken back. flagAsBuiltVariance advances to change_triage and is protected
 * by its own from-state, which is why it takes no key.
 */
export async function attestAsBuiltClean(
  engagementId: string,
  idempotencyKey?: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'attestAsBuiltClean',
    idempotencyKey,
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
