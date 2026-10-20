// What the delivery's execution card renders: the derived stage, its one next
// action, the ids that action needs, and what this role may do about it.
// PURE and CLIENT-SAFE (types and one assembly with no I/O): the server builds
// it once, the card only renders it.
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import type { ExecutionCardFacts } from './queries/facts';
import { executionStage, type ExecutionNextAction, type ExecutionStage } from './stage';

export interface ExecutionCardView {
  stage: ExecutionStage;
  next: ExecutionNextAction | null;
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
    /** `payments` read: the contract's Payments tab opens for this role (A4.3). */
    openPayments: boolean;
  };
}

export function executionCardView(
  card: ExecutionCardFacts,
  context: { projectId: string; may: ExecutionCardView['may'] },
): ExecutionCardView {
  const { stage, next } = executionStage(card.facts);
  return {
    stage,
    next,
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
