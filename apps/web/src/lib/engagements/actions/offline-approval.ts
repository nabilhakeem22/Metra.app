'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  recordOfflineApprovalCore,
  type OfflineApprovalInput,
  type OfflineApprovalTrigger,
} from '../offline-approval-core';

async function recordOfflineApproval(
  engagementId: string,
  trigger: OfflineApprovalTrigger,
  approval: OfflineApprovalInput,
): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await recordOfflineApprovalCore(ctx, { engagementId, trigger, approval });
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

/**
 * "Client approved offline" at `concept_review`: the normal `selectConcept`
 * transition with the approval's provenance (channel, date, note) as its
 * payload. Owner, admin and project manager only. Never throws to the client.
 */
export async function recordOfflineConceptApproval(
  engagementId: string,
  approval: OfflineApprovalInput,
): Promise<ActionResult> {
  return recordOfflineApproval(engagementId, 'selectConcept', approval);
}

/** The same at `final_approval`, through `approveDesign` (Gate B). */
export async function recordOfflineDesignApproval(
  engagementId: string,
  approval: OfflineApprovalInput,
): Promise<ActionResult> {
  return recordOfflineApproval(engagementId, 'approveDesign', approval);
}
