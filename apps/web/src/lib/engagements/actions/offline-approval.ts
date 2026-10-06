'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { executeTransition } from '../executor';

/** What the "Client approved offline" form sends. Parsed by the executor's side-effect. */
export interface OfflineApprovalInput {
  channel: string;
  occurredOn?: string | null;
  note?: string | null;
  chosenArtifactId?: string | null;
}

/**
 * "Client approved offline" at `concept_review`: fires the normal `selectConcept`
 * transition, so every guard and code is the same as Advance's, with the
 * approval's provenance (channel, date, note) as its payload. The side-effect
 * writes it onto the staff `concept_approval` row; the transition row is the
 * audit trail. Revalidates the shell on success. Never throws to the client.
 */
export async function recordOfflineConceptApproval(
  engagementId: string,
  input: OfflineApprovalInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'selectConcept',
    payload: input,
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/** The same at `final_approval`, through `approveDesign` (Gate B). */
export async function recordOfflineDesignApproval(
  engagementId: string,
  input: OfflineApprovalInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await executeTransition(ctx, {
    engagementId,
    trigger: 'approveDesign',
    payload: input,
  });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}
