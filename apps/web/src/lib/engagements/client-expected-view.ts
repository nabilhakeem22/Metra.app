// What the studio's command card says about the client's expected date (Round
// C, C8). PURE and CLIENT-SAFE: the same three-part rule app_delivery_by_token
// applies before the client page shows the date, so the studio sees exactly
// whether the client still sees it.
import type { DesignState } from './states';

/** How far ahead a studio may promise the client a date: a year. */
export const CLIENT_EXPECTED_MAX_DAYS_AHEAD = 365;

/** The three 0058 columns of one delivery, as the header read returns them. */
export interface ClientExpectedRecord {
  /** `YYYY-MM-DD`. */
  on: string;
  /** The stage the date was set in. */
  state: DesignState;
  /** ISO instant the date was set. */
  setAt: string;
}

export type ClientExpectedView =
  | { kind: 'none' }
  /** The client page shows "expected by {on}". */
  | { kind: 'showing'; on: string }
  /** Set, but the client no longer sees it: the date passed or the stage moved. */
  | { kind: 'stale'; on: string };

export interface ClientExpectedViewInput {
  expected: ClientExpectedRecord | null;
  state: DesignState;
  /** The delivery's transition ledger (any order). */
  transitions: ReadonlyArray<{
    fromState: DesignState | null;
    toState: DesignState | null;
    decidedAt: Date | string;
  }>;
  /** Today in Africa/Cairo, `YYYY-MM-DD`. */
  today: string;
}

/**
 * `showing` while the delivery is still in the stage the date was set in, no
 * state move (a transition to a different state) was recorded after it was
 * set, and the date is today or later; otherwise `stale`. `none` when unset.
 */
export function clientExpectedViewOf(input: ClientExpectedViewInput): ClientExpectedView {
  const { expected } = input;
  if (!expected) return { kind: 'none' };
  const setAt = new Date(expected.setAt).getTime();
  const movedSince = input.transitions.some(
    (transition) =>
      transition.toState !== null &&
      transition.toState !== transition.fromState &&
      new Date(transition.decidedAt).getTime() > setAt,
  );
  const showing = expected.state === input.state && expected.on >= input.today && !movedSince;
  return showing ? { kind: 'showing', on: expected.on } : { kind: 'stale', on: expected.on };
}
