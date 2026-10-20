'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { issueFinalAccountCore, type IssueFinalAccountInput } from './issue';
import type { FinalAccountDifferencesPage, FinalAccountView } from './load';
import { loadFinalAccountCore, loadFinalAccountDifferencesCore } from './read-core';

/** The final account card, read when its tab is shown (read-core.ts). */
export async function loadFinalAccount(request: { contractId: string }): Promise<ActionResult & { data?: FinalAccountView }> {
  const ctx = await requireOrg();
  return loadFinalAccountCore(ctx, request);
}

/** The next 50 measured differences (read-core.ts). */
export async function loadFinalAccountDifferences(request: {
  contractId: string;
  afterLineId: string;
}): Promise<ActionResult & { data?: FinalAccountDifferencesPage }> {
  const ctx = await requireOrg();
  return loadFinalAccountDifferencesCore(ctx, request);
}

/**
 * Issue the final account as the contract's last payment request (issue.ts).
 * When it worked, the answer carries the card read once after the commit; a
 * read that fails leaves it out and the card reads itself.
 */
export async function issueFinalAccount(
  input: IssueFinalAccountInput,
): Promise<ActionResult & { data?: string; view?: FinalAccountView }> {
  const ctx = await requireOrg();
  const result = await issueFinalAccountCore(ctx, input);
  if (!result.ok) return result;
  const read = await loadFinalAccountCore(ctx, { contractId: input.contractId });
  return read.ok && read.data ? { ...result, view: read.data } : result;
}
