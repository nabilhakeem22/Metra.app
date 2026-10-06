// When did the review round the client is answering start, and which days may an
// approval taken offline be dated? PURE and CLIENT-SAFE: the executor's
// side-effect enforces these bounds, and the offline-approval form offers the
// same ones as its date picker's min and max.
import { todayInCairo } from '@/lib/automation/clock';
import type { DesignState } from './states';

export interface ReviewRoundInput {
  state: DesignState;
  /** `design_engagements.renders_ready_at`: the render issuance under review. */
  rendersReadyAt: Date | string | null;
  /** When the delivery last entered `concept_review` (its transition row). */
  enteredConceptReviewAt: Date | string | null;
  createdAt: Date | string;
}

/**
 * The instant the round under review began: the renders issuance at
 * `final_approval`, the entry into `concept_review` there, and the delivery's
 * creation when that is not recorded (a legacy row, a rescue entry).
 */
export function reviewRoundStartedAt(input: ReviewRoundInput): Date {
  const start =
    input.state === 'final_approval'
      ? input.rendersReadyAt
      : input.state === 'concept_review'
        ? input.enteredConceptReviewAt
        : null;
  return new Date(start ?? input.createdAt);
}

/** The days, inclusive and as `YYYY-MM-DD` in Cairo, an offline approval may carry. */
export interface OfflineApprovalBounds {
  earliest: string;
  latest: string;
}

/**
 * Not before the round it approves (an approval cannot answer renders that did
 * not exist yet), and not after today. Both are CAIRO days: between 00:00 and
 * 03:00 in Cairo the UTC day is still yesterday, and an honest "today" must be
 * accepted then.
 */
export function offlineApprovalBounds(roundStartedAt: Date, now: Date): OfflineApprovalBounds {
  return { earliest: todayInCairo(roundStartedAt), latest: todayInCairo(now) };
}
