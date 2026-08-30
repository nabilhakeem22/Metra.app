'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import type { SignedUpload } from '@/lib/storage';
import { recordArtifactCore, type RecordArtifactInput } from '../artifacts';
import {
  setArtifactClientVisibilityCore,
  type SetArtifactClientVisibilityInput,
} from '../client-visibility';
import {
  attachDeliverableCore,
  createDeliverableUploadCore,
  getDeliverableUrlCore,
  type AttachDeliverableInput,
  type CreateDeliverableUploadInput,
} from '../deliverable-uploads';

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
 * Server-action wrapper for {@link createDeliverableUploadCore}: resolves the
 * org context and mints a signed upload URL for a delivery deliverable (2D
 * layout / 3D render / BOQ). Returns the SignedUpload on success, or an
 * ActionResult with the rejection code — never throws to the client.
 */
export async function createDeliverableUpload(
  input: CreateDeliverableUploadInput,
): Promise<SignedUpload | ActionResult> {
  const ctx = await requireOrg();
  return createDeliverableUploadCore(ctx, input);
}

/**
 * Server-action wrapper for {@link attachDeliverableCore}: resolves the org
 * context, attaches the uploaded file to the engagement (records the category's
 * attested artifact), and revalidates the shell on success. Returns the
 * ActionResult (new artifact id in `data`) — never throws to the client.
 */
export async function attachDeliverable(
  input: AttachDeliverableInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await attachDeliverableCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * Server-action wrapper for {@link getDeliverableUrlCore}: resolves the org
 * context and returns a 300s signed download URL for an engagement file — never
 * throws to the client.
 */
export async function getDeliverableUrl(
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  const ctx = await requireOrg();
  return getDeliverableUrlCore(ctx, fileId);
}

/**
 * Server-action wrapper for {@link setArtifactClientVisibilityCore}: resolves the
 * org context and shows/hides ONE artifact on the tokenized client portal — the
 * manual override behind auto-share, and the only route by which a manual-only
 * deliverable (a BOQ) ever reaches the client. Revalidates the shell on success.
 * Returns the ActionResult — never throws to the client.
 */
export async function setArtifactClientVisibility(
  input: SetArtifactClientVisibilityInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await setArtifactClientVisibilityCore(ctx, input);
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
