import { describe, expect, test } from 'vitest';
import { offlineApprovalBounds, reviewRoundStartedAt } from './review-round';

const CREATED = '2026-09-01T08:00:00.000Z';
const ENTERED = '2026-09-20T08:00:00.000Z';
const RENDERS = '2026-10-02T08:00:00.000Z';

describe('reviewRoundStartedAt', () => {
  test('final_approval: the render issuance under review', () => {
    expect(
      reviewRoundStartedAt({
        state: 'final_approval',
        rendersReadyAt: RENDERS,
        enteredConceptReviewAt: ENTERED,
        createdAt: CREATED,
      }).toISOString(),
    ).toBe(RENDERS);
  });

  test('concept_review: the entry into the stage', () => {
    expect(
      reviewRoundStartedAt({
        state: 'concept_review',
        rendersReadyAt: null,
        enteredConceptReviewAt: ENTERED,
        createdAt: CREATED,
      }).toISOString(),
    ).toBe(ENTERED);
  });

  test('nothing recorded (a legacy row): the delivery creation', () => {
    for (const state of ['final_approval', 'concept_review'] as const) {
      expect(
        reviewRoundStartedAt({
          state,
          rendersReadyAt: null,
          enteredConceptReviewAt: null,
          createdAt: CREATED,
        }).toISOString(),
      ).toBe(CREATED);
    }
  });
});

describe('offlineApprovalBounds: Cairo days', () => {
  test('at 01:45 in Cairo (22:45 UTC the day before), today is the Cairo day', () => {
    const now = new Date('2026-10-06T22:45:00.000Z');
    expect(offlineApprovalBounds(new Date(RENDERS), now)).toEqual({
      earliest: '2026-10-02',
      latest: '2026-10-07',
    });
  });

  test('a round that began late in the Cairo evening starts on that Cairo day', () => {
    const lateEvening = new Date('2026-10-01T20:30:00.000Z'); // 23:30 in Cairo
    expect(offlineApprovalBounds(lateEvening, new Date('2026-10-07T10:00:00.000Z')).earliest).toBe(
      '2026-10-01',
    );
  });
});
