// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
export const CONTRACT_TABS = ['overview', 'schedule', 'costs', 'variations'] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];

/**
 * The tabs a contract has: only an execution contract (from a BOQ) has a
 * payment schedule and costs, and Costs shows only to a role that reads them.
 */
export function contractTabsFor(
  contract: { sourceBoqId: string | null },
  access: { readsCosts: boolean },
): readonly ContractTab[] {
  if (contract.sourceBoqId === null) return CONTRACT_TABS.filter((tab) => tab !== 'schedule' && tab !== 'costs');
  return access.readsCosts ? CONTRACT_TABS : CONTRACT_TABS.filter((tab) => tab !== 'costs');
}

/** The tab the page opens on: `?tab=` when this contract has it (a link from the delivery card). */
export function openingContractTab(requested: unknown, tabs: readonly ContractTab[]): ContractTab {
  return tabs.find((tab) => tab === requested) ?? 'overview';
}
