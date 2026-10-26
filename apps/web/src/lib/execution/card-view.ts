// What the delivery's execution card renders: the derived stage, its one next
// action, the ids that action needs, and what this role may do about it.
// PURE and CLIENT-SAFE (types and one assembly with no I/O): the server builds
// it once, the card only renders it.
import type { ExecutionFlowFacts } from '@/lib/flow/locate/execution-facts';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { ExecutionCardFacts } from './flow-facts';
import { executionStage, type ExecutionNextAction, type ExecutionStage } from './stage';

export interface ExecutionCardView {
  stage: ExecutionStage;
  next: ExecutionNextAction | null;
  /** The facts the stage came from, for the execution locators (whose move it is). */
  flow: ExecutionFlowFacts;
  projectId: string;
  boqId: string | null;
  contract: { id: string; documentNumber: string } | null;
  /** The schedule row the next payment request would bill, by its labels; null when none is next. */
  nextInstalment: { labelAr: string | null; labelEn: string | null } | null;
  may: {
    /** `contracts_generate` create: owner and admin. */
    generateContract: boolean;
    /** Owner, admin or project manager (owner decision D5). */
    signOffline: boolean;
    /** `contracts_generate` read: the contract page opens for this role. */
    openContract: boolean;
    /** `cost_entries` create: the costs page records for this role (lib/execution/costs/access.ts). */
    recordCosts: boolean;
    /** `invoices_issue` approve: sends payment requests from the Payments tab (A18). */
    sendRequests: boolean;
    /** `payments` create: records payments and answers a client's claim there (A18). */
    recordPayments: boolean;
    /** `site_measurements` create: the measurements page records for this role (measurements/access.ts). */
    recordMeasurements: boolean;
  };
}

export function executionCardView(
  card: ExecutionCardFacts,
  context: { projectId: string; may: ExecutionCardView['may'] },
): ExecutionCardView {
  const { stage, next } = executionStage(card.flow.stage);
  return {
    stage,
    next,
    flow: card.flow,
    projectId: context.projectId,
    boqId: card.boqId,
    contract: card.contract
      ? {
          id: card.contract.id,
          documentNumber: formatDocNumber('C', card.contract.number, docYear(null, card.contract.createdAt)),
        }
      : null,
    nextInstalment: card.nextInstalment,
    may: context.may,
  };
}
