'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { withBillingView, type BillingTab, type WithBillingView } from '../billing/after-write';
import { confirmContractClaimCore, type ConfirmContractClaimInput } from './confirm';
import { dismissContractClaimCore, type DismissContractClaimInput } from './dismiss';

// Each answer carries the Payments tab's view when it worked (../billing/after-write.ts).

/** The money of a client's "I paid" arrived: record it and close the claim (confirm.ts). */
export async function confirmContractClaim(
  input: ConfirmContractClaimInput,
  tab: BillingTab,
): Promise<WithBillingView<ActionResult & { data?: string; already?: boolean }>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await confirmContractClaimCore(ctx, input), tab);
}

/** It did not arrive: close the claim with no payment (dismiss.ts). */
export async function dismissContractClaim(
  input: DismissContractClaimInput,
  tab: BillingTab,
): Promise<WithBillingView<ActionResult>> {
  const ctx = await requireOrg();
  return withBillingView(ctx, await dismissContractClaimCore(ctx, input), tab);
}
