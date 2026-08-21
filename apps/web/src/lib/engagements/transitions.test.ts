import { describe, expect, it } from 'vitest';
import { GUARDS, type GuardKey } from './guards';
import { DESIGN_STATES, type DesignState } from './states';
import {
  TRANSITIONS,
  WIRED_TRIGGERS,
  type Trigger,
} from './transitions';

// The 17 triggers, spelled out independently of the registry so a dropped or
// renamed key fails here (the Record<Trigger,…> type also enforces this at
// compile time; this is the runtime witness).
const ALL_TRIGGERS: Trigger[] = [
  'submitDesignFee',
  'confirmAndPayDeposit',
  'spatialBaseReady',
  'optionsReady',
  'selectConcept',
  'requestRevision',
  'confirmConcept',
  'rendersReady',
  'approveDesign',
  'draftReady',
  'finalizeBOQ',
  'chooseDesignOnly',
  'recipientAcknowledges',
  'chooseExecution',
  'rejectDesign',
  'designChangeRaised',
  'abandon',
];

describe('transition registry', () => {
  it('declares all 17 triggers, exhaustively', () => {
    const keys = Object.keys(TRANSITIONS).sort();
    expect(keys).toEqual([...ALL_TRIGGERS].sort());
    expect(keys).toHaveLength(17);
  });

  it('every def references only known states, guards, and a capability', () => {
    const states = new Set<DesignState>(DESIGN_STATES);
    for (const trigger of ALL_TRIGGERS) {
      const def = TRANSITIONS[trigger];
      const froms = Array.isArray(def.from) ? def.from : [def.from];
      for (const from of froms) expect(states.has(from)).toBe(true);
      expect(states.has(def.to)).toBe(true);
      expect(def.guards.length).toBeGreaterThan(0);
      for (const g of def.guards) expect(GUARDS[g as GuardKey]).toBeTypeOf('function');
      expect(['engagements_design', 'engagements_finance', 'engagements_issue']).toContain(
        def.capability,
      );
      // Only submitDesignFee carries a side-effect this step (Step 3); every other
      // trigger still moves state only.
      if (trigger === 'submitDesignFee') {
        expect(def.sideEffect).toBe('generateFeeSchedule');
      } else {
        expect(def.sideEffect).toBeNull();
      }
    }
  });

  it('every state is reachable: `created` is the entry, all others are some `to`', () => {
    const reachable = new Set<DesignState>(['created']);
    for (const trigger of ALL_TRIGGERS) reachable.add(TRANSITIONS[trigger].to);
    expect([...reachable].sort()).toEqual([...DESIGN_STATES].sort());
  });

  it('submitDesignFee is the ONLY fully-wired trigger; the rest fail closed', () => {
    expect([...WIRED_TRIGGERS]).toEqual(['submitDesignFee']);

    // The wired trigger carries a concrete guard, never the sentinel.
    expect(TRANSITIONS.submitDesignFee.guards).toEqual(['scopeInputsPresent']);
    expect(TRANSITIONS.submitDesignFee.from).toBe('created');
    expect(TRANSITIONS.submitDesignFee.to).toBe('design_proposal');
    expect(TRANSITIONS.submitDesignFee.capability).toBe('engagements_design');
    expect(TRANSITIONS.submitDesignFee.sideEffect).toBe('generateFeeSchedule');

    // Every other trigger routes through pendingGuard (fail-closed).
    for (const trigger of ALL_TRIGGERS) {
      if (trigger === 'submitDesignFee') continue;
      expect(TRANSITIONS[trigger].guards).toContain('pendingGuard');
    }
  });
});
