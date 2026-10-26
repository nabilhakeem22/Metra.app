// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
const CONTRACT_TABS = [
  'overview',
  'schedule',
  'payments',
  'final_account',
  'measurements',
  'costs',
  'cost_sheet',
  'variations',
] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];

/** The tabs only an execution contract (from a BOQ) has. */
const EXECUTION_TABS: ReadonlySet<ContractTab> = new Set([
  'schedule',
  'payments',
  'final_account',
  'measurements',
  'costs',
  'cost_sheet',
]);

/** What this person may open on a contract page, each from its own matrix row. */
export interface ContractTabAccess {
  /** `contracts_generate` read: the contract itself (overview, schedule, change orders). */
  seeContract: boolean;
  /** `payments` read: its payments and its final account. */
  seeBilling: boolean;
  /** `site_measurements` read. */
  seeMeasurements: boolean;
  /** `cost_entries` read: its costs, on this page only alongside the contract itself. */
  readsCosts: boolean;
  /** `margin_pnl` read: the cost sheet. */
  seeCostSheet: boolean;
  /** Owner, admin or project manager: records a client's paper answer to a change order, from the register (H7.3). */
  decidesVariationsOnPaper: boolean;
}

function mayOpen(tab: ContractTab, access: ContractTabAccess): boolean {
  if (tab === 'payments' || tab === 'final_account') return access.seeBilling;
  if (tab === 'measurements') return access.seeMeasurements;
  if (tab === 'costs') return access.seeContract && access.readsCosts;
  if (tab === 'cost_sheet') return access.seeCostSheet;
  if (tab === 'variations') return access.seeContract || access.decidesVariationsOnPaper;
  return access.seeContract;
}

/**
 * The tabs this person sees on this contract. Only an execution contract has a
 * schedule, payments, a final account, measurements, costs and a cost sheet.
 * A project manager or an accountant, who bill, measure and read costs without
 * editing the contract, see those tabs alone, all but the costs: the Costs tab
 * shows here only to a role that reads both the contract and its costs, and the
 * others record costs on the costs page (./costs/page.tsx). The change orders
 * show too to a project manager, who records a client's paper answer there
 * (on a proposal contract they are his only tab). The page itself
 * opens only for a role that reads the contract or its payments (page.tsx); the
 * site engineer measures on the measurements page instead
 * (./measurements/page.tsx) and records costs on the costs page.
 */
export function contractTabsFor(contract: { sourceBoqId: string | null }, access: ContractTabAccess): readonly ContractTab[] {
  const execution = contract.sourceBoqId !== null;
  return CONTRACT_TABS.filter((tab) => (execution || !EXECUTION_TABS.has(tab)) && mayOpen(tab, access));
}

/** The tab the page opens on: `?tab=` when this person has it (a link from the delivery card), else the first. */
export function openingContractTab(requested: unknown, tabs: readonly ContractTab[]): ContractTab {
  return tabs.find((tab) => tab === requested) ?? tabs[0];
}
