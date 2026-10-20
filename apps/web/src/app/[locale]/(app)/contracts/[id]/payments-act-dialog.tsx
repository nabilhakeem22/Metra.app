'use client';

import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { PaymentRequestRow } from '@/lib/execution/requests/queries';
import { RecordPaymentDialog } from './record-payment-dialog';
import { SendRequestDialog, type RequestTarget } from './send-request-dialog';
import type { ContractBilling } from './use-contract-billing';
import { VoidRequestDialog } from './void-request-dialog';

/** The one money act open on the Payments tab. */
export type PaymentsAct =
  | { kind: 'send'; target: RequestTarget }
  | { kind: 'record'; request: PaymentRequestRow }
  | { kind: 'void'; request: PaymentRequestRow };

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
  onClose,
}: {
  act: PaymentsAct;
  view: ContractBillingView;
  billing: ContractBilling;
  m: (value: string) => string;
  onAlreadyRecorded: () => void;
  onClose: () => void;
}) {
  const onAnswered = (next?: ContractBillingView) => {
    if (next) billing.apply(next);
    else void billing.reload();
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
      onCheckPayments={billing.reload}
      onClose={onClose}
    />
  );
}
