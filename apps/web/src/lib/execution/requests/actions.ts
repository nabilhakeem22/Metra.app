'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { withBillingView, type BillingTab, type WithBillingView } from '../billing/after-write';
import {
  issueMilestoneRequestCore,
  type IssueMilestoneRequestInput,
  type IssueMilestoneRequestResult,
} from './issue-milestone';
import { issueVariationRequestCore, type IssueVariationRequestInput } from './issue-variation';
import { voidPaymentRequestCore, type VoidPaymentRequestInput } from './void';

// Each write answers with the Payments tab's view when it worked (after-write.ts).

/** Send the payment request for one schedule row (issue-milestone.ts). */
export async function issueMilestoneRequest(
  input: IssueMilestoneRequestInput,
  tab: BillingTab,
): Promise<WithBillingView<IssueMilestoneRequestResult>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await issueMilestoneRequestCore(ctx, input), tab);
}

/** Send the payment request for one approved change order (issue-variation.ts). */
export async function issueVariationRequest(
  input: IssueVariationRequestInput,
  tab: BillingTab,
): Promise<WithBillingView<ActionResult & { data?: string }>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await issueVariationRequestCore(ctx, input), tab);
}

/** Withdraw an unpaid payment request, with the reason (void.ts). */
export async function voidPaymentRequest(
  input: VoidPaymentRequestInput,
  tab: BillingTab,
): Promise<WithBillingView<ActionResult>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await voidPaymentRequestCore(ctx, input), tab);
}
