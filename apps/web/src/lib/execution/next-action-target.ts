// Where each execution next action takes the studio. PURE and CLIENT-SAFE: the
// delivery's execution card renders from it, and the UI walk
// (lib/engagements/ui-walk.test.ts) proves every derived stage's action has a
// target the card can actually offer. A `Record` over every kind, so a new next
// action does not compile until someone says where it goes.
import type { ExecutionNextActionKind, ExecutionStage } from './stage';

/** The dialogs the execution card opens in place. */
export const EXECUTION_CARD_DIALOGS = ['generate_contract', 'sign_offline'] as const;
export type ExecutionCardDialog = (typeof EXECUTION_CARD_DIALOGS)[number];

/** The contract tabs a money step happens on: the payments, and the final account (A5). */
export type MoneyPage = 'contract_payments' | 'contract_final_account';

/** The pages the card links to: a next action's, and the measurements page beside it. */
export type ExecutionCardPage =
  | 'project_boq'
  | 'contract'
  | 'contract_schedule'
  | 'contract_variations'
  | 'contract_measurements'
  | MoneyPage;

/**
 * What a money step needs (A18), named as the card's `may` names it: sending a
 * request, and so issuing the final account, is `invoices_issue`; recording a
 * payment and reviewing a client's claim are `payments` create. Reading the
 * tab is not enough: a role that can only read is told who does it (A4 F6).
 */
export type MoneyCapability = 'sendRequests' | 'recordPayments';

export type NextActionTarget =
  | { kind: 'link'; page: Exclude<ExecutionCardPage, MoneyPage> }
  | { kind: 'link'; page: MoneyPage; needs: MoneyCapability }
  | { kind: 'dialog'; dialog: ExecutionCardDialog };

const link = (page: Exclude<ExecutionCardPage, MoneyPage>): NextActionTarget => ({ kind: 'link', page });
const money = (page: MoneyPage, needs: MoneyCapability): NextActionTarget => ({ kind: 'link', page, needs });
const dialog = (name: ExecutionCardDialog): NextActionTarget => ({ kind: 'dialog', dialog: name });

export const NEXT_ACTION_TARGET: Readonly<Record<ExecutionNextActionKind, NextActionTarget>> = {
  open_boq: link('project_boq'),
  create_contract: dialog('generate_contract'),
  set_schedule: link('contract_schedule'),
  send_contract: link('contract'),
  record_signed_offline: dialog('sign_offline'),
  // The Payments tab (A4.3): its claims panel (B4.2) confirms or dismisses the
  // claim, and recording a payment on that request waits for the answer.
  review_payment_claim: money('contract_payments', 'recordPayments'),
  send_milestone_request: money('contract_payments', 'sendRequests'),
  send_variation_request: money('contract_payments', 'sendRequests'),
  record_payment: money('contract_payments', 'recordPayments'),
  await_variation_answer: link('contract_variations'),
  // The final account tab (A5.2): its card issues the account, and shows the
  // issued one (voided from the Payments tab) when the balance moved after it.
  prepare_final_account: money('contract_final_account', 'sendRequests'),
  review_final_account: money('contract_final_account', 'sendRequests'),
};

/** The stages whose action waits on the client: the card says so beside it. */
export const STAGES_WAITING_ON_CLIENT: ReadonlySet<ExecutionStage> = new Set<ExecutionStage>(['awaiting_signature']);

/**
 * The stage the card offers "Record measurements" in, beside the next action:
 * works in progress. Before the client signs nothing can be measured, and an
 * issued final account closes the ledger (A14).
 */
export const STAGES_RECORDING_MEASUREMENTS: ReadonlySet<ExecutionStage> = new Set<ExecutionStage>(['in_progress']);

/** The page a link target opens, or null when the id it needs is not there. */
export function executionCardHref(
  page: ExecutionCardPage,
  ids: { projectId: string; contractId: string | null },
): string | null {
  if (page === 'project_boq') return `/projects/${ids.projectId}?tab=boq`;
  if (ids.contractId === null) return null;
  const base = `/contracts/${ids.contractId}`;
  if (page === 'contract_schedule') return `${base}?tab=schedule`;
  if (page === 'contract_payments') return `${base}?tab=payments`;
  if (page === 'contract_final_account') return `${base}?tab=final_account`;
  if (page === 'contract_variations') return `${base}?tab=variations`;
  if (page === 'contract_measurements') return `${base}/measurements`;
  return base;
}
