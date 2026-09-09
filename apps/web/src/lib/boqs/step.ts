// What the cockpit's BOQ step should offer, given what already exists. PURE and
// CLIENT-SAFE — no db, no server-only — so the command card can render it and a
// unit test can reach it without a React tree.
//
// The cockpit's rule is ONE obvious next action per step. Before the structured
// BOQ existed there was exactly one: drop a file. Now there are two paths, and
// the card has to pick which to lead with rather than showing both equally and
// making the studio decide what it is even looking at.

/** Just enough about a project's BOQ to decide what to offer. */
export interface BoqStepSummary {
  id: string;
  status: string;
  lineCount: number;
}

export type BoqStepAction =
  /** Nothing priced yet — lead with building or importing one. */
  | 'start'
  /** Lines exist and it is still a draft — lead with issuing it. */
  | 'issue'
  /** Already issued: the artifact exists and the guard is satisfied. */
  | 'done';

/**
 * A BOQ that exists but has no lines is the same situation as no BOQ at all —
 * an empty document satisfies nothing and there is still nothing to issue — so
 * both resolve to `start` rather than leaving a half-made document looking like
 * progress.
 */
export function boqStepAction(summary: BoqStepSummary | null): BoqStepAction {
  if (!summary || summary.lineCount === 0) return 'start';
  return summary.status === 'draft' ? 'issue' : 'done';
}

/** Where the step's button goes — always the project's BOQ tab. */
export function boqStepHref(projectId: string): string {
  return `/projects/${projectId}?tab=boq`;
}
