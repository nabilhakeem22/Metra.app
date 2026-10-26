// What an actionable hero shows after a client action answered. PURE (no React,
// no server code): the concept picker and the plain action hero render it, a
// unit test pins it. Every answer confirms only a decision that is SAVED; a
// step that moved on reads the same for every hero (`movedOn`) and re-reads the
// page.
import type { ConceptChoiceOutcome } from '@/lib/engagements/concept-choice-outcome';
import type { PortalActError, PortalErrorKey } from '@/lib/engagements/portal-error-key';
import type {
  BudgetPart,
  DesignOutcome,
  DesignWithBudgetOutcome,
  HandoverOutcome,
} from '@/lib/engagements/review-outcome';
import type { HeroOutcome } from './hero-confirmed';

/** The confirmation card: what was recorded, and the SAVED letter when there is one. */
export interface HeroConfirmedState {
  outcome: HeroOutcome;
  studioNotified: boolean;
  chosenLetter?: string;
  /** The one-tap approve+budget: how its budget half ended (Round D). */
  budget?: BudgetPart;
}

/** A portal error, `changed` (the concept letters moved), `reviewChanged` (what the
 *  client saw is not what is on file now), `movedOn` (the review closed), or
 *  `designChangedBudgetSaved` (approve+budget: the design changed so the
 *  approval was not sent, but the budget confirmation was saved: one sentence). */
export type HeroError = PortalErrorKey | 'changed' | 'reviewChanged' | 'movedOn' | 'designChangedBudgetSaved';

/** An act that did not land. `reference`: an unknown failure's, for the client
 *  to quote. `budget`: the one-tap approve+budget saved its budget half; said in
 *  a line of its own beside the error. */
interface HeroRefusal {
  error: HeroError;
  reference?: string;
  budget?: 'acknowledged';
}

export type HeroAnswer = { confirmed: HeroConfirmedState } | (HeroRefusal & { refresh: boolean });

/** What a hero shows when its act did not land (a lost answer is `uncertain`). */
export type HeroFailure = HeroRefusal;

const MOVED_ON: HeroAnswer = { error: 'movedOn', refresh: true };
const REVIEW_CHANGED: HeroAnswer = { error: 'reviewChanged', refresh: true };

/** A failed act's answer, keeping the reference of an unknown failure. */
function failedAct({ error, reference }: PortalActError, refresh: boolean, budget?: 'acknowledged'): HeroAnswer {
  return { error, refresh, ...(reference ? { reference } : {}), ...(budget ? { budget } : {}) };
}

/**
 * The answer to a concept-review action (choose, approve, request changes): it
 * confirms only a decision that is SAVED, so a repeat shows the one on file.
 */
export function answerOfConceptOutcome(outcome: ConceptChoiceOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'chosen':
      return {
        confirmed: { outcome: 'approved', studioNotified: outcome.studioNotified, chosenLetter: outcome.letter },
      };
    case 'approved':
      return { confirmed: { outcome: 'approved', studioNotified: outcome.studioNotified } };
    case 'changes_requested':
      return { confirmed: { outcome: 'changes', studioNotified: outcome.studioNotified } };
    case 'options_changed':
      return { error: 'changed', refresh: true };
    case 'changed':
      return REVIEW_CHANGED;
    case 'moved_on':
      return MOVED_ON;
    case 'error':
      return failedAct(outcome, false);
  }
}

/** The answer to a final-design action: the decision SAVED, which a stale tab may not have tapped. */
export function answerOfDesignOutcome(outcome: DesignOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'approved':
      return { confirmed: { outcome: 'approved', studioNotified: outcome.studioNotified } };
    case 'changes_requested':
      return { confirmed: { outcome: 'changes', studioNotified: outcome.studioNotified } };
    case 'changed':
      return REVIEW_CHANGED;
    case 'moved_on':
      return MOVED_ON;
    case 'error':
      return failedAct(outcome, false);
  }
}

/**
 * The answer to the one-tap approve+budget (owner decision 2). The design's
 * status comes from the design outcome only; the budget's line talks only
 * about the budget (D3 F1).
 * - A decision on file: its card, with a budget line.
 * - The design changed: "your approval was not sent", and, when the budget was
 *   saved, ONE sentence that says both (F4).
 * - The design half failed after a saved budget: the error, a budget line, and
 *   a refresh so the page shows what was saved (R4).
 * - A stop before the design (a dead link, a budget write that threw): the
 *   portal error alone.
 */
export function answerOfDesignWithBudgetOutcome(outcome: DesignWithBudgetOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'approved':
    case 'changes_requested':
      return {
        confirmed: {
          outcome: outcome.kind === 'approved' ? 'approved' : 'changes',
          studioNotified: outcome.studioNotified,
          budget: outcome.budget,
        },
      };
    case 'changed':
      return outcome.budget === 'acknowledged' ? { error: 'designChangedBudgetSaved', refresh: true } : REVIEW_CHANGED;
    case 'moved_on':
      return outcome.budget === 'acknowledged' ? { ...MOVED_ON, budget: 'acknowledged' } : MOVED_ON;
    case 'error':
      return outcome.budget ? failedAct(outcome, true, outcome.budget) : failedAct(outcome, false);
  }
}

/** The answer to the handover confirmation: confirmed while one is on file. */
export function answerOfHandoverOutcome(outcome: HandoverOutcome): HeroAnswer {
  switch (outcome.kind) {
    case 'acknowledged':
      return { confirmed: { outcome: 'acknowledged', studioNotified: outcome.studioNotified } };
    case 'changed':
      return REVIEW_CHANGED;
    case 'moved_on':
      return MOVED_ON;
    case 'error':
      return failedAct(outcome, false);
  }
}
