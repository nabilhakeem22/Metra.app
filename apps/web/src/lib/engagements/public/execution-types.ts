// The client's execution card on the delivery page (/d, Stage 2 D1a), as the
// browser receives it. PURE TYPES and CLIENT-SAFE: the server reader
// (./execution.ts) builds them, the card renders them. Every figure is what the
// CLIENT is asked to pay or has paid (scale-4 strings); nothing here names a
// studio's own price basis, and the SQL never returns one.
import type { PortalPaymentDetails } from './types';

/** One payment request (مطالبة دفع) the studio sent, newest first. */
export interface PortalExecutionRequest {
  id: string;
  /** PR-YYYY-NNNN. */
  documentNumber: string;
  /** What it bills: a schedule row by its labels, a change order by its number, or the final account. */
  target:
    | { kind: 'milestone'; labelAr: string | null; labelEn: string | null }
    | { kind: 'variation'; documentNumber: string | null }
    | { kind: 'final_account' };
  amount: string;
  paid: string;
  /** What is still due; zero on a void request. */
  outstanding: string;
  /** `YYYY-MM-DD`. */
  issuedOn: string;
  dueOn: string | null;
  /** A withdrawn request stays listed, with nothing due. */
  void: boolean;
  /** When the client's "I paid" on it was sent, while the studio has not answered it; else null. */
  claimedAt: string | null;
}

/** Money the studio recorded as received, newest first. */
export interface PortalExecutionReceipt {
  amount: string;
  /** `YYYY-MM-DD`. */
  receivedOn: string;
  /** The request it paid, PR-YYYY-NNNN. */
  requestNumber: string;
}

/**
 * A claim of the client's still waiting on ANOTHER contract of the delivery
 * (B4 F6): the card shows one contract, so a newer one must not hide what the
 * client said they paid on the one before it. Newest first.
 */
export interface PortalEarlierClaim {
  /** The request it is on, PR-YYYY-NNNN. */
  requestNumber: string;
  /** What the client said they paid (what was due then). */
  amount: string;
  /** When it was sent (an ISO instant). */
  claimedAt: string;
}

export type PortalContractStatus = 'issued' | 'signed' | 'terminated';

export interface PortalExecution {
  contract: {
    /** C-YYYY-NNNN. */
    documentNumber: string;
    status: PortalContractStatus;
    titleAr: string | null;
    titleEn: string | null;
    originalValue: string;
  };
  /** At most the newest 60. */
  requests: PortalExecutionRequest[];
  requestsTruncated: boolean;
  /** At most the newest 60. */
  receipts: PortalExecutionReceipt[];
  receiptsTruncated: boolean;
  /** At most EARLIER_CLAIMS_CAP. */
  earlierClaims: PortalEarlierClaim[];
  /** How to pay, only while something is due and the studio set a usable method. */
  paymentDetails: PortalPaymentDetails | null;
}

/** The newest requests and receipts the card carries (the SQL's own cap). */
export const EXECUTION_LIST_CAP = 60;

/** The waiting claims on the delivery's other contracts the card carries (the SQL's own cap). */
export const EARLIER_CLAIMS_CAP = 10;
