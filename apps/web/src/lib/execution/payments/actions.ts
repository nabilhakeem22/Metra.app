'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { withBillingView, type BillingTab, type WithBillingView } from '../billing/after-write';
import { checkPaymentAttemptCore, type CheckPaymentAttemptInput } from './check-attempt';
import { recordContractPaymentCore, type RecordContractPaymentInput } from './core';

/** Record money received against one payment request (core.ts); answers with the tab's view (after-write.ts). */
export async function recordContractPayment(
  input: RecordContractPaymentInput,
  tab: BillingTab,
): Promise<WithBillingView<ActionResult & { data?: string; already?: boolean }>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await recordContractPaymentCore(ctx, input), tab);
}

/** Did an earlier attempt land, read behind the request's lock (check-attempt.ts); answers with the tab's view. */
export async function checkPaymentAttempt(
  input: CheckPaymentAttemptInput,
  tab: BillingTab,
): Promise<WithBillingView<ActionResult & { data?: { landed: boolean } }>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await checkPaymentAttemptCore(ctx, input), tab);
}
