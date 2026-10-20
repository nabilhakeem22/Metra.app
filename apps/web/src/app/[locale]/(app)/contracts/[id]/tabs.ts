// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
export const CONTRACT_TABS = ['overview', 'costs', 'variations'] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];

/** The tabs a contract shows: Costs only on an execution contract, to a role that reads its costs. */
export function contractTabsFor(showsCosts: boolean): readonly ContractTab[] {
  return showsCosts ? CONTRACT_TABS : CONTRACT_TABS.filter((tab) => tab !== 'costs');
}
