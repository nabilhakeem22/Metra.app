// Which variation-order transitions the CONTRACT still permits — PURE and
// CLIENT-SAFE (no db, no `server-only`), mirroring lib/variations/validation.ts
// so the commercial rule "a dead contract carries no commercial change" is
// unit-testable without a database and can be reused by the client bundle.
import type { ContractStatus, VariationStatus } from '@metra/db';

/**
 * A contract is commercially live only while it is issued or signed. `draft`
 * has not reached the client yet and `terminated` has left them: neither can
 * carry a priced change.
 */
export const ACTIVE_CONTRACT_STATUSES = ['issued', 'signed'] as const;

export function isContractActive(status: ContractStatus): boolean {
  return (ACTIVE_CONTRACT_STATUSES as readonly string[]).includes(status);
}

/** draft -> internal_approved is legal only under a live contract. */
export function canInternalApproveVariation(
  voStatus: VariationStatus,
  contractStatus: ContractStatus,
): boolean {
  return voStatus === 'draft' && isContractActive(contractStatus);
}

/** internal_approved -> issued is legal only under a live contract. */
export function canIssueVariation(
  voStatus: VariationStatus,
  contractStatus: ContractStatus,
): boolean {
  return voStatus === 'internal_approved' && isContractActive(contractStatus);
}

/**
 * Variation statuses that still await a decision. Terminating the contract
 * closes them out; `approved` and `rejected` are already decided and are left
 * exactly as they are (approved work was agreed and still owes money).
 */
export const OPEN_VARIATION_STATUSES = [
  'draft',
  'internal_approved',
  'issued',
] as const;

export function variationsToRejectOnTermination(
  voStatus: VariationStatus,
): boolean {
  return (OPEN_VARIATION_STATUSES as readonly string[]).includes(voStatus);
}
