'use server';

import { getLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  mintDeliveryLinkCore,
  revokeDeliveryLinkCore,
  rotateDeliveryLinkCore,
} from './share';
import {
  recordRomAcknowledgementCore,
  type RecordRomAcknowledgementInput,
} from './approvals';
import { recordArtifactCore, type RecordArtifactInput } from './artifacts';
import { createEngagementCore, type CreateEngagementInput } from './core';
import { executeTransition } from './executor';
import {
  logPaymentAndAdvanceCore,
  type LogPaymentAndAdvanceInput,
} from './pay-and-advance';
import { recordPaymentCore, type RecordPaymentInput } from './payments';
import { setEngagementRomCore, type SetEngagementRomInput } from './rom';
import type {
  GenerateFeeSchedulePayload,
  RequestRevisionPayload,
} from './transitions';

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
 * increments the revision counter and — once it crosses the free allowance —
 * raises a design-fee change order, which REQUIRES a positive `changeOrderAmount`
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
 * Server-action wrapper for {@link logPaymentAndAdvanceCore} — the Hero's combined
 * "Log payment & advance" (Epic D, Slice 3). Resolves the org context, runs the
 * sequential core (record payment → advance), and revalidates the shell WHENEVER
 * the payment persisted (even if the advance guard still blocks), so the ledger +
 * re-checked gate preview refresh. Returns the transition's ActionResult (or the
 * payment error) — never throws to the client.
 */
export async function logPaymentAndAdvance(
  engagementId: string,
  input: LogPaymentAndAdvanceInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const { paymentRecorded, ...result } = await logPaymentAndAdvanceCore(
    ctx,
    engagementId,
    input,
  );
  if (paymentRecorded) revalidatePath('/', 'layout');
  return result;
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
 * Absolute origin for a client share link. Prefers the public NEXT_PUBLIC_APP_URL
 * env var (never a secret), else derives it from the request headers. Mirrors the
 * proposal/contract share-link origin resolver.
 */
async function resolveOrigin(): Promise<string> {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (override) return override;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('cannot resolve request origin for share link');
  return `${proto}://${host}`;
}

/** Build the durable public portal URL for a freshly-minted RAW token. */
async function deliveryLink(rawToken: string): Promise<string> {
  let locale = 'ar-EG';
  try {
    locale = await getLocale();
  } catch {
    /* default locale */
  }
  const origin = await resolveOrigin();
  return `${origin}/${locale}/d/${rawToken}`;
}

/**
 * Server-action wrapper for {@link mintDeliveryLinkCore}: mints the FIRST client
 * share link and returns its absolute URL ONCE (`link`) — the raw token is never
 * re-retrievable. Revalidates the shell on success. Never throws to the client.
 */
export async function shareDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const res = await mintDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const link = await deliveryLink(res.data);
  revalidatePath('/', 'layout');
  return { ok: true, link };
}

/**
 * Server-action wrapper for {@link rotateDeliveryLinkCore}: replaces the link
 * (the previous token stops working) and returns the fresh absolute URL ONCE.
 * Revalidates the shell on success. Never throws to the client.
 */
export async function rotateDeliveryLink(
  engagementId: string,
): Promise<ActionResult & { link?: string }> {
  const ctx = await requireOrg();
  const res = await rotateDeliveryLinkCore(ctx, engagementId);
  if (!res.ok || !res.data) return { ok: res.ok, error: res.error };
  const link = await deliveryLink(res.data);
  revalidatePath('/', 'layout');
  return { ok: true, link };
}

/**
 * Server-action wrapper for {@link revokeDeliveryLinkCore}: turns the client link
 * off (the portal 404s). Revalidates the shell on success. Never throws.
 */
export async function revokeDeliveryLink(
  engagementId: string,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await revokeDeliveryLinkCore(ctx, engagementId);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
