import { describe, expect, it } from 'vitest';
import { deriveCommandCard, forwardMovesOf } from './command-card';
import type { EngagementGatePreview, GateChecklistItem } from './gate-preview';
import type { GuardKey } from './guards';
import type { Trigger } from './transitions';

function item(guard: GuardKey, ok: boolean, amountDue: string | null = null): GateChecklistItem {
  return { guard, ok, code: ok ? null : 'generic', amountDue };
}

function preview(
  primaryTrigger: Trigger | null,
  items: GateChecklistItem[],
  awaitingClientReview = false,
): EngagementGatePreview {
  return {
    primaryTrigger,
    endingChoices: [],
    items,
    allClear: items.every((i) => i.ok),
    awaitingClientReview,
    clientDecision: null,
  };
}

/** The execution_decision preview: no forward trigger, the two endings, the balance gate. */
function choicePreview(balanceCleared: boolean): EngagementGatePreview {
  const items = [item('balanceCleared', balanceCleared, balanceCleared ? null : '2000.0000')];
  return {
    primaryTrigger: null,
    endingChoices: ['chooseDesignOnly', 'chooseExecution'],
    items,
    allClear: balanceCleared,
    awaitingClientReview: false,
    clientDecision: null,
  };
}

describe('deriveCommandCard', () => {
  it('is closed at a terminal state (isTerminal) regardless of the trigger', () => {
    const view = deriveCommandCard(preview('approveDesign', [item('romAcknowledged', true)]), {
      canAdvance: true,
      isTerminal: true,
    });
    expect(view.mode).toBe('closed');
    expect(view.advanceEnabled).toBe(false);
    expect(view.showNudge).toBe(false);
    expect(view.nextPhaseState).toBeNull();
  });

  it('is closed when there is no forward trigger', () => {
    const view = deriveCommandCard(preview(null, []), {
      canAdvance: true,
      isTerminal: false,
    });
    expect(view.mode).toBe('closed');
    expect(view.advanceEnabled).toBe(false);
  });

  it('is ready (direct fire) when every guard is met', () => {
    // confirmAndPayDeposit -> survey, non-payload trigger, deposit cleared.
    const view = deriveCommandCard(
      preview('confirmAndPayDeposit', [item('depositCleared', true)]),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('ready');
    expect(view.advanceEnabled).toBe(true);
    expect(view.advanceNeedsForm).toBe(false);
    expect(view.nextPhaseState).toBe('survey');
    expect(view.primaryBlocker).toBeNull();
  });

  it('ready keeps Advance disabled when the role may not fire it', () => {
    const view = deriveCommandCard(
      preview('confirmAndPayDeposit', [item('depositCleared', true)]),
      { canAdvance: false, isTerminal: false },
    );
    expect(view.mode).toBe('ready');
    expect(view.advanceEnabled).toBe(false);
  });

  it('is ready-needs-form for a payload trigger (submitDesignFee)', () => {
    const view = deriveCommandCard(
      preview('submitDesignFee', [item('scopeInputsPresent', true)]),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('ready');
    expect(view.advanceEnabled).toBe(true);
    expect(view.advanceNeedsForm).toBe(true);
    expect(view.nextPhaseState).toBe('design_proposal');
  });

  it('is blockedStudio when a non-client-actionable guard is unmet', () => {
    // rendersReady -> rendersPresent is studio work, never gates the client.
    const view = deriveCommandCard(
      preview('rendersReady', [item('rendersPresent', false)]),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('blockedStudio');
    expect(view.advanceEnabled).toBe(false);
    expect(view.primaryBlocker).toBe('rendersPresent');
    expect(view.blockingGuards).toEqual(['rendersPresent']);
    expect(view.showNudge).toBe(false);
  });

  it('prefers a studio blocker over a client money guard when both are unmet', () => {
    // approveDesign: romAcknowledged (studio) unmet + gateBInstallmentCleared (client) unmet.
    const view = deriveCommandCard(
      preview('approveDesign', [
        item('romAcknowledged', false),
        item('asBuiltReconciled', true),
        item('gateBInstallmentCleared', false, '5000.0000'),
      ]),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('blockedStudio');
    expect(view.primaryBlocker).toBe('romAcknowledged');
    expect(view.blockingGuards).toEqual(['romAcknowledged', 'gateBInstallmentCleared']);
  });

  it('is blockedClient with a nudge when only money guards are unmet', () => {
    const view = deriveCommandCard(
      preview('confirmAndPayDeposit', [item('depositCleared', false, '10000.0000')]),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('blockedClient');
    expect(view.advanceEnabled).toBe(false);
    expect(view.showNudge).toBe(true);
    expect(view.primaryBlocker).toBe('depositCleared');
    expect(view.blockingGuards).toEqual(['depositCleared']);
  });

  it('never reports a blocked mode without an unmet item for the checklist to show', () => {
    // The card no longer repeats the blocker in a note under Advance: it relies
    // on the CHECKLIST (rendered only when `items.length > 0`) naming it. That is
    // safe because a guard-blocked mode is derived FROM unmet items: with no items
    // the view is 'ready', never blocked. The one blocked mode without an unmet
    // guard is the client review, and its headline names what is awaited.
    const noItems = deriveCommandCard(preview('rendersReady', []), {
      canAdvance: true,
      isTerminal: false,
    });
    expect(noItems.mode).toBe('ready');

    const blocked = [
      deriveCommandCard(preview('rendersReady', [item('rendersPresent', false)]), {
        canAdvance: true,
        isTerminal: false,
      }),
      deriveCommandCard(
        preview('confirmAndPayDeposit', [item('depositCleared', false, '10000.0000')]),
        { canAdvance: true, isTerminal: false },
      ),
    ];
    for (const view of blocked) {
      expect(view.mode).not.toBe('ready');
      expect(view.blockingGuards.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveCommandCard while the client owes the review', () => {
  const metAtConceptReview = (awaiting: boolean) =>
    preview('selectConcept', [item('gateAInstallmentCleared', true)], awaiting);

  it('every guard met, no client answer: waiting on the client, no Advance', () => {
    const view = deriveCommandCard(metAtConceptReview(true), { canAdvance: true, isTerminal: false });
    expect(view).toMatchObject({
      mode: 'blockedClient',
      advanceEnabled: false,
      showNudge: true,
      primaryBlocker: null,
      endingsEnabled: false,
      awaitingClientReview: true,
      offlineApprovalEnabled: true,
    });
  });

  it('offers the offline approval only to a role that may advance', () => {
    const view = deriveCommandCard(metAtConceptReview(true), { canAdvance: false, isTerminal: false });
    expect(view.mode).toBe('blockedClient');
    expect(view.offlineApprovalEnabled).toBe(false);
  });

  it('once the client has answered, the card is ready again', () => {
    const view = deriveCommandCard(metAtConceptReview(false), { canAdvance: true, isTerminal: false });
    expect(view.mode).toBe('ready');
    expect(view.awaitingClientReview).toBe(false);
  });

  it('a client money guard unmet as well: blockedClient as before, flagged, no offline approval yet', () => {
    const view = deriveCommandCard(
      preview('selectConcept', [item('gateAInstallmentCleared', false, '20000.0000')], true),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('blockedClient');
    expect(view.primaryBlocker).toBe('gateAInstallmentCleared');
    expect(view.awaitingClientReview).toBe(true);
    expect(view.offlineApprovalEnabled).toBe(false);
  });

  it('a studio blocker wins, and neither flag is set', () => {
    const view = deriveCommandCard(
      preview('approveDesign', [item('romAcknowledged', false)], true),
      { canAdvance: true, isTerminal: false },
    );
    expect(view.mode).toBe('blockedStudio');
    expect(view.awaitingClientReview).toBe(false);
    expect(view.offlineApprovalEnabled).toBe(false);
  });
});

describe('deriveCommandCard at the execution_decision choice', () => {
  it('is ready with the endings enabled and Advance off once the balance clears', () => {
    const view = deriveCommandCard(choicePreview(true), { canAdvance: true, isTerminal: false });
    expect(view.mode).toBe('ready');
    expect(view.advanceEnabled).toBe(false);
    expect(view.advanceNeedsForm).toBe(false);
    expect(view.endingsEnabled).toBe(true);
    expect(view.nextPhaseState).toBeNull();
    expect(view.endingChoices).toEqual(['chooseDesignOnly', 'chooseExecution']);
  });

  it('keeps the endings disabled for a role that may not fire them', () => {
    const view = deriveCommandCard(choicePreview(true), { canAdvance: false, isTerminal: false });
    expect(view.endingsEnabled).toBe(false);
  });

  it('is blockedClient (not closed) while the balance is unpaid, endings off', () => {
    const view = deriveCommandCard(choicePreview(false), { canAdvance: true, isTerminal: false });
    expect(view.mode).toBe('blockedClient');
    expect(view.endingsEnabled).toBe(false);
    expect(view.endingChoices).toEqual(['chooseDesignOnly', 'chooseExecution']);
  });

  it('is closed at a terminal state even with endings in the preview', () => {
    const view = deriveCommandCard(choicePreview(true), { canAdvance: true, isTerminal: true });
    expect(view.mode).toBe('closed');
    expect(view.endingChoices).toEqual([]);
  });
});

describe('forwardMovesOf', () => {
  it('is the forward trigger when there is one, else the endings', () => {
    expect(forwardMovesOf({ primaryTrigger: 'rendersReady', endingChoices: [] })).toEqual([
      'rendersReady',
    ]);
    expect(
      forwardMovesOf({ primaryTrigger: null, endingChoices: ['chooseDesignOnly', 'chooseExecution'] }),
    ).toEqual(['chooseDesignOnly', 'chooseExecution']);
    expect(forwardMovesOf({ primaryTrigger: null, endingChoices: [] })).toEqual([]);
  });
});
