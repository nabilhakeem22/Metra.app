// A contract's REVISED value: the one rule every surface that shows a contract's
// value reads (its contract page, and a project's and a client's contracted
// value). PURE and CLIENT-SAFE.
import { computeRevisedContractValue } from '@/lib/aggregates/contract-value';
import { executionRevisedValue } from '@/lib/execution/money/variation-charge';

/** What a contract's value is made of, as far as its change orders are concerned. */
export interface ContractValueBasis {
  originalValue: string;
  sourceBoqId: string | null;
  taxRate: string;
  supervisionPct: string;
}

/**
 * Revised value (computed, A3) = original + what the approved orders add. A
 * proposal contract adds their net change, as it always has. An execution
 * contract's original value already carries VAT and supervision, so it adds
 * each order's full charge (D4a, F1), rounded per order as it is billed.
 */
export function contractRevisedValue(contract: ContractValueBasis, approvedNetDeltas: readonly string[]): string {
  if (contract.sourceBoqId === null) {
    return computeRevisedContractValue(contract.originalValue, approvedNetDeltas);
  }
  return executionRevisedValue(contract.originalValue, approvedNetDeltas, contract.taxRate, contract.supervisionPct);
}
