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
): EngagementGatePreview {
  return { primaryTrigger, endingChoices: [], items, allClear: items.every((i) => i.ok) };
}

/** The execution_decision preview: no forward trigger, the two endings, the balance gate. */
function choicePreview(balanceCleared: boolean): EngagementGatePreview {
  const items = [item('balanceCleared', balanceCleared, balanceCleared ? null : '2000.0000')];
  return {
    primaryTrigger: null,
    endingChoices: ['chooseDesignOnly', 'chooseExecution'],
    items,
    allClear: balanceCleared,
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
    // The card no longer repeats the blocker in a note under Advance — it relies
    // on the CHECKLIST (rendered only when `items.length > 0`) naming it. That is
    // safe because a blocked mode is derived FROM unmet items: with no items the
    // view is 'ready', never blocked. If this invariant ever breaks, a blocked
    // card could show no blocker at all.
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
