'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import type { ContractPaymentsPage } from '../payments/queries';
import { loadContractBillingCore, loadContractPaymentsCore } from './read-core';
import type { ContractBillingView } from './view';

/** The Payments tab, read when it is shown and after each change it makes (read-core.ts). */
export async function loadContractBilling(request: {
  contractId: string;
}): Promise<ActionResult & { data?: ContractBillingView }> {
  const ctx = await requireOrg();
  return loadContractBillingCore(ctx, request);
}

/** The ledger's "show more": the next 50 payments (read-core.ts). */
export async function loadContractPayments(request: {
  contractId: string;
  cursor: string;
}): Promise<ActionResult & { data?: ContractPaymentsPage }> {
  const ctx = await requireOrg();
  return loadContractPaymentsCore(ctx, request);
}
