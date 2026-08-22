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
      // Side-effect-carrying triggers: submitDesignFee -> Step 3,
      // confirmAndPayDeposit -> Step 4, selectConcept -> Step 7; every other
      // trigger still moves state only.
      if (trigger === 'submitDesignFee') {
        expect(def.sideEffect).toBe('generateFeeSchedule');
      } else if (trigger === 'confirmAndPayDeposit') {
        expect(def.sideEffect).toBe('activateOnDeposit');
      } else if (trigger === 'selectConcept') {
        expect(def.sideEffect).toBe('recordConceptApproval');
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

  it('submitDesignFee + confirmAndPayDeposit + spatialBaseReady + optionsReady + selectConcept are wired; the rest fail closed', () => {
    expect([...WIRED_TRIGGERS].sort()).toEqual(
      [
        'confirmAndPayDeposit',
        'optionsReady',
        'selectConcept',
        'spatialBaseReady',
        'submitDesignFee',
      ].sort(),
    );

    // Each wired trigger carries a concrete guard, never the sentinel.
    expect(TRANSITIONS.submitDesignFee.guards).toEqual(['scopeInputsPresent']);
    expect(TRANSITIONS.submitDesignFee.from).toBe('created');
    expect(TRANSITIONS.submitDesignFee.to).toBe('design_proposal');
    expect(TRANSITIONS.submitDesignFee.capability).toBe('engagements_design');
    expect(TRANSITIONS.submitDesignFee.sideEffect).toBe('generateFeeSchedule');

    expect(TRANSITIONS.confirmAndPayDeposit.guards).toEqual(['depositCleared']);
    expect(TRANSITIONS.confirmAndPayDeposit.from).toBe('design_proposal');
    expect(TRANSITIONS.confirmAndPayDeposit.to).toBe('survey');
    expect(TRANSITIONS.confirmAndPayDeposit.capability).toBe('engagements_finance');
    expect(TRANSITIONS.confirmAndPayDeposit.sideEffect).toBe('activateOnDeposit');

    // spatialBaseReady (Step 5): the artifact IS the stored spatial base, so no
    // side-effect — just the survey -> layout state move under its Off-Plan guard.
    expect(TRANSITIONS.spatialBaseReady.guards).toEqual(['spatialBaseReady']);
    expect(TRANSITIONS.spatialBaseReady.from).toBe('survey');
    expect(TRANSITIONS.spatialBaseReady.to).toBe('layout');
    expect(TRANSITIONS.spatialBaseReady.capability).toBe('engagements_design');
    expect(TRANSITIONS.spatialBaseReady.sideEffect).toBeNull();

    // optionsReady (Step 6): the 2–4 concept-options gate is a pure state move
    // (layout -> concept_review) — no side-effect, reuses engagement_artifacts.
    expect(TRANSITIONS.optionsReady.guards).toEqual(['optionsReady']);
    expect(TRANSITIONS.optionsReady.from).toBe('layout');
    expect(TRANSITIONS.optionsReady.to).toBe('concept_review');
    expect(TRANSITIONS.optionsReady.capability).toBe('engagements_design');
    expect(TRANSITIONS.optionsReady.sideEffect).toBeNull();

    // selectConcept (Step 7): the Gate-A installment gate (concept_review ->
    // negotiation) writes ONE append-only concept_approval event as its side-effect.
    expect(TRANSITIONS.selectConcept.guards).toEqual(['gateAInstallmentCleared']);
    expect(TRANSITIONS.selectConcept.from).toBe('concept_review');
    expect(TRANSITIONS.selectConcept.to).toBe('negotiation');
    expect(TRANSITIONS.selectConcept.capability).toBe('engagements_design');
    expect(TRANSITIONS.selectConcept.sideEffect).toBe('recordConceptApproval');

    // Every other trigger routes through pendingGuard (fail-closed).
    const wired = new Set<Trigger>([
      'submitDesignFee',
      'confirmAndPayDeposit',
      'spatialBaseReady',
      'optionsReady',
      'selectConcept',
    ]);
    for (const trigger of ALL_TRIGGERS) {
      if (wired.has(trigger)) continue;
      expect(TRANSITIONS[trigger].guards).toContain('pendingGuard');
    }
  });
});
