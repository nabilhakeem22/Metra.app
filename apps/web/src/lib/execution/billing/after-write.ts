import 'server-only';
// What a Payments-tab write answers with when it worked: the tab's view, read
// ONCE after the write committed (A4 reliability R1). The writes used to call
// refreshApp(), and in Next 15 any revalidatePath inside a server action makes
// the answer a full re-render of the page it was called from (the contract
// header, the change-order list, the layout and the bell: 115 to 185 KB the
// tab threw away), and the tab then read itself again. No server-rendered
// surface of the contract page shows billing (the tab always reads itself on
// demand), so nothing else needs revalidating; the delivery card and the
// cockpit render fresh on their next navigation.
//
// The tab is named by the CALLER, as loadContractBilling names it: the read is
// that action's, under the same gate (`payments` read) and the caller's RLS,
// so it shows nothing the caller could not already read. A read that fails
// leaves the view out, and the tab reads itself instead: the write's answer is
// never turned into a failure by the read after it.
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { loadContractBillingCore } from './read-core';
import type { ContractBillingView } from './view';

/** The Payments tab a write was made from: the contract whose view it answers with. */
export interface BillingTab {
  contractId: string;
}

export type WithBillingView<R extends ActionResult> = R & { view?: ContractBillingView };

export async function withBillingView<R extends ActionResult>(
  ctx: OrgContext,
  result: R,
  tab: unknown,
): Promise<WithBillingView<R>> {
  if (!result.ok) return result;
  const read = await loadContractBillingCore(ctx, tab);
  return read.ok && read.data ? { ...result, view: read.data } : result;
}
