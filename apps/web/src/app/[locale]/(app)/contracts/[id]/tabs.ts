// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
export const CONTRACT_TABS = ['overview', 'schedule', 'payments', 'variations'] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];

/** The tabs only an execution contract (from a BOQ) has. */
const EXECUTION_TABS: ReadonlySet<ContractTab> = new Set(['schedule', 'payments']);

/**
 * The tabs this person sees on this contract. Only an execution contract has a
 * schedule and payments. `seeContract` (`contracts_generate` read) opens the
 * contract itself; `seeBilling` (`payments` read) opens its payments, so a
 * project manager or an accountant, who bill and record without editing the
 * contract, see the Payments tab alone. None at all: the page is not theirs.
 */
export function contractTabsFor(
  contract: { sourceBoqId: string | null },
  access: { seeContract: boolean; seeBilling: boolean },
): readonly ContractTab[] {
  const execution = contract.sourceBoqId !== null;
  return CONTRACT_TABS.filter((tab) => {
    if (EXECUTION_TABS.has(tab) && !execution) return false;
    return tab === 'payments' ? access.seeBilling : access.seeContract;
  });
}

/** The tab the page opens on: `?tab=` when this person has it (a link from the delivery card), else the first. */
export function openingContractTab(requested: unknown, tabs: readonly ContractTab[]): ContractTab {
  return tabs.find((tab) => tab === requested) ?? tabs[0];
}
