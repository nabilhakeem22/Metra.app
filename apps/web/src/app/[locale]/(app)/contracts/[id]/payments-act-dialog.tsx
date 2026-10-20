'use client';

import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { PendingClaimRow } from '@/lib/execution/claims/queries';
import type { PaymentRequestRow } from '@/lib/execution/requests/queries';
import { ConfirmClaimDialog } from './confirm-claim-dialog';
import { DismissClaimDialog } from './dismiss-claim-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';
import { SendRequestDialog, type RequestTarget } from './send-request-dialog';
import type { ContractBilling } from './use-contract-billing';
import { VoidRequestDialog } from './void-request-dialog';

/** The one money act open on the Payments tab. */
export type PaymentsAct =
  | { kind: 'send'; target: RequestTarget }
  | { kind: 'record'; request: PaymentRequestRow }
  | { kind: 'void'; request: PaymentRequestRow }
  | { kind: 'confirmClaim'; claim: PendingClaimRow }
  | { kind: 'dismissClaim'; claim: PendingClaimRow };

/**
 * The dialog of the open act, held by the TAB rather than by the row that
 * opened it: every answer re-reads the tab, and a re-read that moves a row (a
 * schedule row now billed, a change order no longer listed, a request now paid)
 * must not unmount the dialog that is saying what happened. A request's dialog
 * shows the request as the view now has it (what is due after the re-read),
 * else as it was when opened.
 */
export function PaymentsActDialog({
  act,
  view,
  billing,
  m,
  onAlreadyRecorded,
  onAlreadyConfirmed,
  onClose,
}: {
  act: PaymentsAct;
  view: ContractBillingView;
  billing: ContractBilling;
  m: (value: string) => string;
  onAlreadyRecorded: () => void;
  onAlreadyConfirmed: () => void;
  onClose: () => void;
}) {
  // Any answer, or none: the view it came with, else a read. Resolves to the
  // view the tab now shows (null when the read failed), so a dialog whose
  // answer was lost can see whether its act is done after all (L2).
  const onAnswered = async (next?: ContractBillingView): Promise<ContractBillingView | null> => {
    if (!next) return billing.reload();
    billing.apply(next);
    return next;
  };
  if (act.kind === 'send') {
    return (
      <SendRequestDialog
        contractId={view.contractId}
        target={act.target}
        balance={view.billingBalance}
        m={m}
        onAnswered={onAnswered}
        onClose={onClose}
      />
    );
  }
  if (act.kind === 'confirmClaim') {
    return (
      <ConfirmClaimDialog contractId={view.contractId} claim={act.claim} onAnswered={onAnswered} onAlreadyConfirmed={onAlreadyConfirmed} onClose={onClose} />
    );
  }
  if (act.kind === 'dismissClaim') {
    return <DismissClaimDialog contractId={view.contractId} claim={act.claim} onAnswered={onAnswered} onClose={onClose} />;
  }
  const request = view.requests.find((row) => row.id === act.request.id) ?? act.request;
  if (act.kind === 'void') {
    return <VoidRequestDialog contractId={view.contractId} request={request} onAnswered={onAnswered} onClose={onClose} />;
  }
  return (
    <RecordPaymentDialog
      contractId={view.contractId}
      contractIssuedOn={view.issuedOn}
      request={request}
      m={m}
      onAnswered={onAnswered}
      onAlreadyRecorded={onAlreadyRecorded}
      onClose={onClose}
    />
  );
}
