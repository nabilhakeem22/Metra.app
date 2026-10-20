'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import {
  issueMilestoneRequestCore,
  type IssueMilestoneRequestInput,
  type IssueMilestoneRequestResult,
} from './issue-milestone';
import { issueVariationRequestCore, type IssueVariationRequestInput } from './issue-variation';
import { voidPaymentRequestCore, type VoidPaymentRequestInput } from './void';

/** Send the payment request for one schedule row (issue-milestone.ts). */
export async function issueMilestoneRequest(input: IssueMilestoneRequestInput): Promise<IssueMilestoneRequestResult> {
  const ctx = await requireOrg();
  const res = await issueMilestoneRequestCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/** Send the payment request for one approved change order (issue-variation.ts). */
export async function issueVariationRequest(
  input: IssueVariationRequestInput,
): Promise<ActionResult & { data?: string }> {
  const ctx = await requireOrg();
  const res = await issueVariationRequestCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

/** Withdraw an unpaid payment request, with the reason (void.ts). */
export async function voidPaymentRequest(input: VoidPaymentRequestInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await voidPaymentRequestCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}
