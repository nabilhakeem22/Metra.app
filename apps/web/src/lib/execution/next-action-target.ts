// Where each execution next action takes the studio. PURE and CLIENT-SAFE: the
// delivery's execution card renders from it, and the UI walk
// (lib/engagements/ui-walk.test.ts) proves every derived stage's action has a
// target the card can actually offer. A `Record` over every kind, so a new next
// action does not compile until someone says where it goes.
import type { ExecutionNextActionKind, ExecutionStage } from './stage';

/** The dialogs the execution card opens in place. */
export const EXECUTION_CARD_DIALOGS = ['generate_contract', 'sign_offline'] as const;
export type ExecutionCardDialog = (typeof EXECUTION_CARD_DIALOGS)[number];

/** The pages a next action links to. */
export type ExecutionCardPage = 'project_boq' | 'contract' | 'contract_schedule' | 'contract_variations';

export type NextActionTarget =
  | { kind: 'link'; page: ExecutionCardPage }
  | { kind: 'dialog'; dialog: ExecutionCardDialog };

const link = (page: ExecutionCardPage): NextActionTarget => ({ kind: 'link', page });
const dialog = (name: ExecutionCardDialog): NextActionTarget => ({ kind: 'dialog', dialog: name });

/**
 * Money actions (requests, payments, claims, the final account) open the
 * contract: its payments tab arrives with PR A4, on that same page.
 */
export const NEXT_ACTION_TARGET: Readonly<Record<ExecutionNextActionKind, NextActionTarget>> = {
  open_boq: link('project_boq'),
  create_contract: dialog('generate_contract'),
  set_schedule: link('contract_schedule'),
  send_contract: link('contract'),
  record_signed_offline: dialog('sign_offline'),
  review_payment_claim: link('contract'),
  send_milestone_request: link('contract'),
  send_variation_request: link('contract_variations'),
  record_payment: link('contract'),
  await_variation_answer: link('contract_variations'),
  prepare_final_account: link('contract'),
  review_final_account: link('contract'),
};

/** The stages whose action waits on the client: the card says so beside it. */
export const STAGES_WAITING_ON_CLIENT: ReadonlySet<ExecutionStage> = new Set<ExecutionStage>(['awaiting_signature']);

/** The page a link target opens, or null when the id it needs is not there. */
export function executionCardHref(
  page: ExecutionCardPage,
  ids: { projectId: string; contractId: string | null },
): string | null {
  if (page === 'project_boq') return `/projects/${ids.projectId}?tab=boq`;
  if (ids.contractId === null) return null;
  const base = `/contracts/${ids.contractId}`;
  if (page === 'contract_schedule') return `${base}?tab=schedule`;
  if (page === 'contract_variations') return `${base}?tab=variations`;
  return base;
}
