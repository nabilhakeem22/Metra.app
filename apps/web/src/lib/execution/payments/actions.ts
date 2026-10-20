'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { recordContractPaymentCore, type RecordContractPaymentInput } from './core';

/** Record money received against one payment request (core.ts). */
export async function recordContractPayment(
  input: RecordContractPaymentInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  const ctx = await requireOrg();
  const res = await recordContractPaymentCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}
