import { describe, expect, test } from 'vitest';
import type { EngagementEventKind } from '@metra/db';
import {
  currentRoundClientDecision,
  isAwaitingClientReview,
  type ClientReviewEvent,
} from './client-review';
import { liveEvents } from './event-provenance';
import type { DesignState } from './states';

const RENDERS_READY = new Date('2026-06-10T10:00:00.000Z');
const OTHER_ROUND = new Date('2026-05-01T10:00:00.000Z');
const BEFORE = new Date('2026-06-01T10:00:00.000Z');
const AFTER = new Date('2026-06-12T10:00:00.000Z');

type LedgerRow = ClientReviewEvent & { supersedesEventId: string | null };

let sequence = 0;
function event(
  kind: EngagementEventKind,
  overrides: Partial<LedgerRow> = {},
): LedgerRow {
  sequence += 1;
  return {
    id: `ev-${sequence}`,
    kind,
    actorChannel: 'client',
    acknowledgedIssueAt: null,
    decidedAt: AFTER,
    supersedesEventId: null,
    ...overrides,
  };
}

const APPROVE: Record<'concept_review' | 'final_approval', EngagementEventKind> = {
  concept_review: 'concept_approval',
  final_approval: 'design_approval',
};
const CHANGES: Record<'concept_review' | 'final_approval', EngagementEventKind> = {
  concept_review: 'concept_change_request',
  final_approval: 'design_change_request',
};

/** The caller's contract: the rule is handed LIVE events. */
function awaiting(state: DesignState, ledger: LedgerRow[]): boolean {
  return isAwaitingClientReview({
    state,
    rendersReadyAt: RENDERS_READY,
    events: liveEvents(ledger),
  });
}

describe.each(['concept_review', 'final_approval'] as const)('%s', (state) => {
  test('no event: waiting', () => {
    expect(awaiting(state, [])).toBe(true);
  });

  test('the client approved (stamped with this round): not waiting', () => {
    expect(awaiting(state, [event(APPROVE[state], { acknowledgedIssueAt: RENDERS_READY })])).toBe(false);
  });

  test('the client asked for changes (stamped with this round): not waiting', () => {
    expect(awaiting(state, [event(CHANGES[state], { acknowledgedIssueAt: RENDERS_READY })])).toBe(false);
  });

  test('a staff-only approval is not the client answering', () => {
    expect(awaiting(state, [event(APPROVE[state], { actorChannel: 'staff' })])).toBe(true);
  });

  test('a retracted client decision answers nothing', () => {
    const decision = event(APPROVE[state], { acknowledgedIssueAt: RENDERS_READY });
    const correction = event('event_correction', {
      actorChannel: 'staff',
      supersedesEventId: decision.id,
    });
    expect(awaiting(state, [decision, correction])).toBe(true);
  });

  test('another kind of client event does not answer the review', () => {
    expect(awaiting(state, [event('rom_acknowledgement')])).toBe(true);
  });
});

describe('the design round (final_approval)', () => {
  test('a legacy unstamped decision made AFTER the current renders answers this round', () => {
    expect(awaiting('final_approval', [event('design_change_request', { decidedAt: AFTER })])).toBe(
      false,
    );
  });

  test('a legacy unstamped decision made BEFORE the current renders does not', () => {
    expect(awaiting('final_approval', [event('design_change_request', { decidedAt: BEFORE })])).toBe(
      true,
    );
  });

  test('a decision stamped with another render issuance does not', () => {
    expect(
      awaiting('final_approval', [event('design_approval', { acknowledgedIssueAt: OTHER_ROUND })]),
    ).toBe(true);
  });

  test('no issuance recorded at all (legacy delivery): one decision answers', () => {
    expect(
      isAwaitingClientReview({
        state: 'final_approval',
        rendersReadyAt: null,
        events: [event('design_change_request', { decidedAt: BEFORE })],
      }),
    ).toBe(false);
  });
});

describe('the concept review is a single round', () => {
  test('an unstamped decision made before the current renders still counts', () => {
    expect(awaiting('concept_review', [event('concept_change_request', { decidedAt: BEFORE })])).toBe(
      false,
    );
  });
});

describe('currentRoundClientDecision', () => {
  test('returns the newest client decision of the round', () => {
    const older = event('design_change_request', { acknowledgedIssueAt: RENDERS_READY, decidedAt: AFTER });
    const newer = event('design_approval', {
      acknowledgedIssueAt: RENDERS_READY,
      decidedAt: new Date('2026-06-13T10:00:00.000Z'),
    });
    expect(
      currentRoundClientDecision({ state: 'final_approval', rendersReadyAt: RENDERS_READY, events: [older, newer] })
        ?.id,
    ).toBe(newer.id);
  });

  test('outside the two review stages there is nothing to wait for', () => {
    for (const state of ['negotiation', 'design_3d', 'execution_decision'] as const) {
      expect(awaiting(state, [])).toBe(false);
      expect(
        currentRoundClientDecision({ state, rendersReadyAt: RENDERS_READY, events: [event('design_approval')] }),
      ).toBeNull();
    }
  });
});
