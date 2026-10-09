import type { DesignEngagement, EngagementMilestone } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { evaluateGatePreview } from './gate-preview-evaluate';
import type { GuardFacts } from './guards';
import type { GuardEvent } from './guards/facts';
import type { DesignState } from './states';

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const EPOCH = new Date('2026-01-01T00:00:00Z');

function engagement(state: DesignState, designFee: string | null): DesignEngagement {
  return {
    id: ENGAGEMENT_ID,
    orgId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    number: 1,
    titleAr: 'تشطيب',
    titleEn: 'Fit-out',
    clientId: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
    state,
    designFee,
    offPlan: false,
    asBuiltDue: false,
    freeRevisionN: 3,
    revisionCount: 0,
    freeDesignRevisionN: 3,
    designRevisionCount: 0,
    romLow: null,
    romHigh: null,
    romIssuedAt: null,
    conceptLockedAt: null,
    renderManifestHash: null,
    rendersReadyAt: null,
    tokenHash: null,
    tokenNonce: null,
    shareExpiresAt: null,
    clientExpectedOn: null,
    clientExpectedState: null,
    clientExpectedSetAt: null,
  };
}

function balanceMilestone(): EngagementMilestone {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    orgId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    engagementId: ENGAGEMENT_ID,
    kind: 'balance',
    basis: 'percent',
    value: '20.0000',
    sortOrder: 3,
  };
}

function facts(state: DesignState, milestones: EngagementMilestone[]): GuardFacts {
  return {
    engagement: engagement(state, '10000.0000'),
    milestones,
    payments: [],
    artifacts: [],
    changeOrders: [],
    events: [],
  };
}

describe('evaluateGatePreview', () => {
  it('offers the endings, not a forward trigger, at execution_decision', () => {
    const preview = evaluateGatePreview(facts('execution_decision', []));
    expect(preview.primaryTrigger).toBeNull();
    expect(preview.endingChoices).toEqual(['chooseDesignOnly', 'chooseExecution']);
    expect(preview.items.map((item) => item.guard)).toEqual(['balanceCleared']);
    expect(preview.allClear).toBe(true);
  });

  it('carries the balance shortfall on the endings checklist while it is unpaid', () => {
    const preview = evaluateGatePreview(facts('execution_decision', [balanceMilestone()]));
    expect(preview.allClear).toBe(false);
    expect(preview.items[0]).toMatchObject({ guard: 'balanceCleared', ok: false, amountDue: '2000.0000' });
  });

  it('resolves the forward trigger elsewhere, with no endings', () => {
    const preview = evaluateGatePreview(facts('boq', []));
    expect(preview.primaryTrigger).toBe('finalizeBOQ');
    expect(preview.endingChoices).toEqual([]);
  });

  it('is empty and all-clear at a terminal state', () => {
    expect(evaluateGatePreview(facts('execution', []))).toEqual({
      primaryTrigger: null,
      endingChoices: [],
      items: [],
      allClear: true,
      awaitingClientReview: false,
      clientDecision: null,
    });
  });
});

function clientEvent(kind: GuardEvent['kind'], decidedAt: Date): GuardEvent {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    kind,
    actorChannel: 'client',
    supersedesEventId: null,
    decidedAt,
    createdAt: decidedAt,
    hasVariance: null,
    acknowledgedIssueAt: null,
    rangeLow: null,
    rangeHigh: null,
    chosenArtifactId: null,
    chosenPosition: null,
  };
}

describe('evaluateGatePreview: the client review', () => {
  it('concept_review, every guard met, no client decision: waiting on the client', () => {
    const preview = evaluateGatePreview(facts('concept_review', []));
    expect(preview.allClear).toBe(true);
    expect(preview.awaitingClientReview).toBe(true);
    expect(preview.clientDecision).toBeNull();
  });

  it('once the client answers, the wait ends and the decision is carried', () => {
    const decidedAt = new Date('2026-02-01T09:00:00Z');
    const preview = evaluateGatePreview({
      ...facts('concept_review', []),
      events: [clientEvent('concept_change_request', decidedAt)],
    });
    expect(preview.awaitingClientReview).toBe(false);
    expect(preview.clientDecision).toEqual({
      kind: 'concept_change_request',
      decidedAt: decidedAt.toISOString(),
      chosenArtifactId: null,
      chosenPosition: null,
    });
  });

  it('a concept choice carries the letter position SAVED with it (B12)', () => {
    const option = '88888888-8888-4888-8888-888888888888';
    const preview = evaluateGatePreview({
      ...facts('concept_review', []),
      events: [
        {
          ...clientEvent('concept_approval', new Date('2026-02-01T09:00:00Z')),
          chosenArtifactId: option,
          chosenPosition: 2,
        },
      ],
    });
    expect(preview.clientDecision).toMatchObject({ chosenArtifactId: option, chosenPosition: 2 });
  });

  it('outside a review stage nothing waits on a client review', () => {
    expect(evaluateGatePreview(facts('boq', [])).awaitingClientReview).toBe(false);
  });
});
