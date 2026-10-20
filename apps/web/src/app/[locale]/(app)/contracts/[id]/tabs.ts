// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
export const CONTRACT_TABS = ['overview', 'schedule', 'variations'] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];

/** The tabs a contract has: only an execution contract (from a BOQ) has a payment schedule. */
export function contractTabsFor(contract: { sourceBoqId: string | null }): readonly ContractTab[] {
  return contract.sourceBoqId === null ? CONTRACT_TABS.filter((tab) => tab !== 'schedule') : CONTRACT_TABS;
}

/** The tab the page opens on: `?tab=` when this contract has it (a link from the delivery card). */
export function openingContractTab(requested: unknown, tabs: readonly ContractTab[]): ContractTab {
  return tabs.find((tab) => tab === requested) ?? 'overview';
}
