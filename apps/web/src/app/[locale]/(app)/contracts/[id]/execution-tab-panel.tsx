'use client';

import { CostSheetTab } from './cost-sheet-tab';
import { FinalAccountCard } from './final-account-card';
import { MeasurementsTab } from './measurements-tab';
import { PaymentsTab } from './payments-tab';
import type { BillingMay } from './request-row';
import type { ContractTab } from './tabs';

/** The execution tabs that read themselves on demand, never with the page. */
export type OnDemandTab = Extract<ContractTab, 'payments' | 'final_account' | 'measurements' | 'cost_sheet'>;

/** What this role may do on them: bill and record (A18), and record measurements. */
export interface ExecutionMay extends BillingMay {
  measure: boolean;
}

export function isOnDemandTab(tab: ContractTab): tab is OnDemandTab {
  return tab === 'payments' || tab === 'final_account' || tab === 'measurements' || tab === 'cost_sheet';
}

/**
 * One of the execution contract's money and site tabs. Each mounts when it is
 * shown and reads itself through its own gated action, so the contract page
 * never carries their rows and costs the same however large the contract.
 */
export function ExecutionTabPanel({
  tab,
  contractId,
  may,
  m,
}: {
  tab: OnDemandTab;
  contractId: string;
  may: ExecutionMay;
  m: (value: string) => string;
}) {
  if (tab === 'payments') return <PaymentsTab contractId={contractId} may={may} m={m} />;
  if (tab === 'final_account') return <FinalAccountCard contractId={contractId} canIssue={may.issue} m={m} />;
  if (tab === 'measurements') return <MeasurementsTab contractId={contractId} canRecord={may.measure} />;
  return <CostSheetTab contractId={contractId} m={m} />;
}
