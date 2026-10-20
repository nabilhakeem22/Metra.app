// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
export const CONTRACT_TABS = ['overview', 'schedule', 'payments', 'costs', 'variations'] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];

/** The tabs only an execution contract (from a BOQ) has. */
const EXECUTION_TABS: ReadonlySet<ContractTab> = new Set(['schedule', 'payments', 'costs']);

/** What this person may open on a contract page, each from its own matrix row. */
export interface ContractTabAccess {
  /** `contracts_generate` read: the contract itself (overview, schedule, change orders). */
  seeContract: boolean;
  /** `payments` read: its payments. */
  seeBilling: boolean;
  /** `cost_entries` read: its costs, on this page only alongside the contract itself. */
  readsCosts: boolean;
}

function mayOpen(tab: ContractTab, access: ContractTabAccess): boolean {
  if (tab === 'payments') return access.seeBilling;
  if (tab === 'costs') return access.seeContract && access.readsCosts;
  return access.seeContract;
}

/**
 * The tabs this person sees on this contract. Only an execution contract has a
 * schedule, payments and costs. `seeContract` (`contracts_generate` read) opens
 * the contract itself; `seeBilling` (`payments` read) opens its payments, so a
 * project manager or an accountant, who bill and record without editing the
 * contract, see the Payments tab alone. Costs show here only to a role that
 * reads both the contract and its costs; the others record costs on the costs
 * page (./costs/page.tsx). None at all: the page is not theirs.
 */
export function contractTabsFor(contract: { sourceBoqId: string | null }, access: ContractTabAccess): readonly ContractTab[] {
  const execution = contract.sourceBoqId !== null;
  return CONTRACT_TABS.filter((tab) => (execution || !EXECUTION_TABS.has(tab)) && mayOpen(tab, access));
}

/** The tab the page opens on: `?tab=` when this person has it (a link from the delivery card), else the first. */
export function openingContractTab(requested: unknown, tabs: readonly ContractTab[]): ContractTab {
  return tabs.find((tab) => tab === requested) ?? tabs[0];
}
