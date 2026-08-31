import { describe, expect, it } from 'vitest';
import { CLIENT_RELEASES } from './client-release';
import { GUARDS, type GuardKey } from './guards';
import { DESIGN_STATES, type DesignState } from './states';
import {
  TRANSITIONS,
  WIRED_TRIGGERS,
  type Trigger,
} from './transitions';

// The 19 triggers, spelled out independently of the registry so a dropped or
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
  'flagAsBuiltVariance',
  'attestAsBuiltClean',
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
  it('declares all 19 triggers, exhaustively', () => {
    const keys = Object.keys(TRANSITIONS).sort();
    expect(keys).toEqual([...ALL_TRIGGERS].sort());
    expect(keys).toHaveLength(19);
  });

  it('every def references only known states, guards, and a capability', () => {
    const states = new Set<DesignState>(DESIGN_STATES);
    for (const trigger of ALL_TRIGGERS) {
      const def = TRANSITIONS[trigger];
      const froms = Array.isArray(def.from) ? def.from : [def.from];
      for (const from of froms) expect(states.has(from)).toBe(true);
      expect(states.has(def.to)).toBe(true);
      // The four guard-less edges: requestRevision (Step 8 — a revision from
      // negotiation is always allowed), rejectDesign (Step 14 — a rejection from
      // final_approval is always allowed), designChangeRaised (the 3D revision
      // loop — same precedent: revising the design is always allowed while it is
      // in flight), and abandon (tail wiring — the off-ramp is always allowed; the
      // UI confirm-gates it instead). Every other edge carries a guard.
      if (
        trigger === 'requestRevision' ||
        trigger === 'rejectDesign' ||
        trigger === 'designChangeRaised' ||
        trigger === 'abandon'
      ) {
        expect(def.guards).toEqual([]);
      } else {
        expect(def.guards.length).toBeGreaterThan(0);
      }
      for (const g of def.guards) expect(GUARDS[g as GuardKey]).toBeTypeOf('function');
      expect(['engagements_design', 'engagements_finance', 'engagements_issue']).toContain(
        def.capability,
      );
      // Side-effect-carrying triggers: submitDesignFee -> Step 3,
      // confirmAndPayDeposit -> Step 4, selectConcept -> Step 7, requestRevision ->
      // Step 8; `applyRevision` is SHARED by requestRevision (concept) and
      // designChangeRaised (3D) — one mechanism, not two; every other trigger
      // still moves state only.
      if (trigger === 'submitDesignFee') {
        expect(def.sideEffect).toBe('generateFeeSchedule');
      } else if (trigger === 'confirmAndPayDeposit') {
        expect(def.sideEffect).toBe('activateOnDeposit');
      } else if (trigger === 'selectConcept') {
        expect(def.sideEffect).toBe('recordConceptApproval');
      } else if (
        trigger === 'requestRevision' ||
        trigger === 'designChangeRaised'
      ) {
        expect(def.sideEffect).toBe('applyRevision');
      } else if (trigger === 'confirmConcept') {
        expect(def.sideEffect).toBe('settleConceptAndLock');
      } else if (trigger === 'rendersReady') {
        expect(def.sideEffect).toBe('captureRenderManifest');
      } else if (trigger === 'flagAsBuiltVariance') {
        expect(def.sideEffect).toBe('recordAsBuiltVariance');
      } else if (trigger === 'attestAsBuiltClean') {
        expect(def.sideEffect).toBe('recordAsBuiltClean');
      } else if (trigger === 'approveDesign') {
        expect(def.sideEffect).toBe('recordDesignApproval');
      } else if (trigger === 'rejectDesign') {
        expect(def.sideEffect).toBe('resetRevisionsOnReject');
      } else {
        expect(def.sideEffect).toBeNull();
      }
    }
  });

  it('exactly 3 triggers carry a client release, and each names the right package', () => {
    const carrying = ALL_TRIGGERS.filter(
      (trigger) => TRANSITIONS[trigger].clientRelease !== undefined,
    );
    expect(carrying.sort()).toEqual(
      ['chooseDesignOnly', 'optionsReady', 'rendersReady'].sort(),
    );
    expect(TRANSITIONS.optionsReady.clientRelease).toBe('conceptPackage');
    expect(TRANSITIONS.rendersReady.clientRelease).toBe('designPackage');
    expect(TRANSITIONS.chooseDesignOnly.clientRelease).toBe('handoverPackage');
    // Every release key is a declared release, and rendersReady proves release and
    // side-effect are independent fields that can coexist on one edge.
    for (const trigger of carrying) {
      expect(CLIENT_RELEASES[TRANSITIONS[trigger].clientRelease!]).toBeDefined();
    }
    expect(TRANSITIONS.rendersReady.sideEffect).toBe('captureRenderManifest');
    // finalizeBOQ must NEVER release anything — the BOQ is manual-only.
    expect(TRANSITIONS.finalizeBOQ.clientRelease).toBeUndefined();
  });

  it('every state is reachable: `created` is the entry, all others are some `to`', () => {
    const reachable = new Set<DesignState>(['created']);
    for (const trigger of ALL_TRIGGERS) reachable.add(TRANSITIONS[trigger].to);
    expect([...reachable].sort()).toEqual([...DESIGN_STATES].sort());
  });

  it('all 19 triggers are wired; nothing routes through the fail-closed sentinel', () => {
    // The 3D revision loop wired `designChangeRaised`, so WIRED_TRIGGERS is now
    // the COMPLETE trigger set — there is no declared-but-unfireable edge left.
    expect([...WIRED_TRIGGERS].sort()).toEqual([...ALL_TRIGGERS].sort());
    expect(WIRED_TRIGGERS.size).toBe(19);

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

    // requestRevision (Step 8): the negotiation -> negotiation self-loop is
    // guard-less (always allowed); applyRevision increments the counter + raises
    // a change order once the free allowance is crossed.
    expect(TRANSITIONS.requestRevision.guards).toEqual([]);
    expect(TRANSITIONS.requestRevision.from).toBe('negotiation');
    expect(TRANSITIONS.requestRevision.to).toBe('negotiation');
    expect(TRANSITIONS.requestRevision.capability).toBe('engagements_design');
    expect(TRANSITIONS.requestRevision.sideEffect).toBe('applyRevision');

    // confirmConcept (Step 9): the change-order settlement gate (negotiation ->
    // design_3d) settles every raised change order + stamps concept_locked_at as
    // its side-effect, once revisionCosSettled proves the outstanding total covered.
    expect(TRANSITIONS.confirmConcept.guards).toEqual(['revisionCosSettled']);
    expect(TRANSITIONS.confirmConcept.from).toBe('negotiation');
    expect(TRANSITIONS.confirmConcept.to).toBe('design_3d');
    expect(TRANSITIONS.confirmConcept.capability).toBe('engagements_design');
    expect(TRANSITIONS.confirmConcept.sideEffect).toBe('settleConceptAndLock');

    // rendersReady (Step 11): the render-baseline gate (design_3d ->
    // final_approval) captures the approved-render manifest hash + stamps
    // renders_ready_at as its side-effect, once rendersPresent proves at least
    // one approved render exists.
    expect(TRANSITIONS.rendersReady.guards).toEqual(['rendersPresent']);
    expect(TRANSITIONS.rendersReady.from).toBe('design_3d');
    expect(TRANSITIONS.rendersReady.to).toBe('final_approval');
    expect(TRANSITIONS.rendersReady.capability).toBe('engagements_design');
    expect(TRANSITIONS.rendersReady.sideEffect).toBe('captureRenderManifest');

    // flagAsBuiltVariance (Step 13): the Off-Plan as-built variance detour
    // (final_approval -> change_triage) appends one as_built_attestation event
    // (has_variance=true) as its side-effect, gated by asBuiltDueOpen.
    expect(TRANSITIONS.flagAsBuiltVariance.guards).toEqual(['asBuiltDueOpen']);
    expect(TRANSITIONS.flagAsBuiltVariance.from).toBe('final_approval');
    expect(TRANSITIONS.flagAsBuiltVariance.to).toBe('change_triage');
    expect(TRANSITIONS.flagAsBuiltVariance.capability).toBe('engagements_design');
    expect(TRANSITIONS.flagAsBuiltVariance.sideEffect).toBe('recordAsBuiltVariance');

    // attestAsBuiltClean (Step 13): the clean attestation targeting final_approval
    // — the self-loop from final_approval AND the change_triage reconciliation —
    // appends one as_built_attestation event (has_variance=false).
    expect(TRANSITIONS.attestAsBuiltClean.guards).toEqual(['asBuiltDueOpen']);
    expect(TRANSITIONS.attestAsBuiltClean.from).toEqual([
      'final_approval',
      'change_triage',
    ]);
    expect(TRANSITIONS.attestAsBuiltClean.to).toBe('final_approval');
    expect(TRANSITIONS.attestAsBuiltClean.capability).toBe('engagements_design');
    expect(TRANSITIONS.attestAsBuiltClean.sideEffect).toBe('recordAsBuiltClean');

    // approveDesign (Step 14, Gate B): the compound guard closes the design phase
    // (final_approval -> shop_drawings) — ROM ack, then as-built reconciliation,
    // then the Gate-B installment (ack/reconcile surface before money) — and appends
    // one design_approval event as its side-effect.
    // revisionCosSettled is LAST: the 3D revision loop can raise a priced change
    // order at final_approval / shop_drawings, and the return path
    // (rendersReady -> final_approval -> approveDesign) must re-check settlement or
    // that change order goes uncollected while the design is approved. Keeping it
    // after gateBInstallmentCleared preserves `moneyGuardOf` -> gate_b.
    expect(TRANSITIONS.approveDesign.guards).toEqual([
      'romAcknowledged',
      'asBuiltReconciled',
      'gateBInstallmentCleared',
      'revisionCosSettled',
    ]);
    expect(TRANSITIONS.approveDesign.from).toBe('final_approval');
    expect(TRANSITIONS.approveDesign.to).toBe('shop_drawings');
    expect(TRANSITIONS.approveDesign.capability).toBe('engagements_design');
    expect(TRANSITIONS.approveDesign.sideEffect).toBe('recordDesignApproval');

    // rejectDesign (Step 14, Gate B): a guard-less bounce back to negotiation
    // (final_approval -> negotiation) whose side-effect refills the free-revision
    // allowance (revision_count -> 0) and reopens the concept lock.
    expect(TRANSITIONS.rejectDesign.guards).toEqual([]);
    expect(TRANSITIONS.rejectDesign.from).toBe('final_approval');
    expect(TRANSITIONS.rejectDesign.to).toBe('negotiation');
    expect(TRANSITIONS.rejectDesign.capability).toBe('engagements_design');
    expect(TRANSITIONS.rejectDesign.sideEffect).toBe('resetRevisionsOnReject');

    // designChangeRaised (the 3D revision loop): guard-less, from BOTH
    // final_approval and shop_drawings back to design_3d, so the studio can act
    // on a client design-change request and re-issue a revised 3D. It REUSES
    // `applyRevision` — the concept stage's mechanism — so the revision counter
    // and the over-allowance change order are priced by one rule, not two.
    expect(TRANSITIONS.designChangeRaised.guards).toEqual([]);
    expect(TRANSITIONS.designChangeRaised.from).toEqual([
      'final_approval',
      'shop_drawings',
    ]);
    expect(TRANSITIONS.designChangeRaised.to).toBe('design_3d');
    expect(TRANSITIONS.designChangeRaised.capability).toBe('engagements_design');
    expect(TRANSITIONS.designChangeRaised.sideEffect).toBe('applyRevision');

    // draftReady (tail): at least one recorded shop_drawing artifact opens the
    // BOQ stage — a pure state move (recording IS attesting).
    expect(TRANSITIONS.draftReady.guards).toEqual(['shopDrawingsPresent']);
    expect(TRANSITIONS.draftReady.from).toBe('shop_drawings');
    expect(TRANSITIONS.draftReady.to).toBe('boq');
    expect(TRANSITIONS.draftReady.capability).toBe('engagements_design');
    expect(TRANSITIONS.draftReady.sideEffect).toBeNull();

    // finalizeBOQ (tail): a recorded boq artifact closes documentation and opens
    // the execution decision — finance family (priced work).
    expect(TRANSITIONS.finalizeBOQ.guards).toEqual(['boqPresent']);
    expect(TRANSITIONS.finalizeBOQ.from).toBe('boq');
    expect(TRANSITIONS.finalizeBOQ.to).toBe('execution_decision');
    expect(TRANSITIONS.finalizeBOQ.capability).toBe('engagements_finance');
    expect(TRANSITIONS.finalizeBOQ.sideEffect).toBeNull();

    // The execution-decision fan-out (tail, owner-locked): the BALANCE gates
    // BOTH exits — the final installment clears before either ending.
    expect(TRANSITIONS.chooseDesignOnly.guards).toEqual(['balanceCleared']);
    expect(TRANSITIONS.chooseDesignOnly.from).toBe('execution_decision');
    expect(TRANSITIONS.chooseDesignOnly.to).toBe('design_only_handoff');
    expect(TRANSITIONS.chooseDesignOnly.capability).toBe('engagements_design');
    expect(TRANSITIONS.chooseDesignOnly.sideEffect).toBeNull();

    expect(TRANSITIONS.chooseExecution.guards).toEqual(['balanceCleared']);
    expect(TRANSITIONS.chooseExecution.from).toBe('execution_decision');
    expect(TRANSITIONS.chooseExecution.to).toBe('execution');
    expect(TRANSITIONS.chooseExecution.capability).toBe('engagements_design');
    expect(TRANSITIONS.chooseExecution.sideEffect).toBeNull();

    // recipientAcknowledges (tail): one handoff_acknowledgement event (ANY actor
    // channel) closes the design-only ending — issue family (owner/admin).
    expect(TRANSITIONS.recipientAcknowledges.guards).toEqual([
      'handoffAcknowledged',
    ]);
    expect(TRANSITIONS.recipientAcknowledges.from).toBe('design_only_handoff');
    expect(TRANSITIONS.recipientAcknowledges.to).toBe('closed_design_only');
    expect(TRANSITIONS.recipientAcknowledges.capability).toBe(
      'engagements_issue',
    );
    expect(TRANSITIONS.recipientAcknowledges.sideEffect).toBeNull();

    // abandon (tail): the guard-less off-ramp from every non-terminal state
    // (the UI confirm-gates it); no side-effect.
    expect(TRANSITIONS.abandon.guards).toEqual([]);
    expect(TRANSITIONS.abandon.to).toBe('abandoned');
    expect(TRANSITIONS.abandon.capability).toBe('engagements_design');
    expect(TRANSITIONS.abandon.sideEffect).toBeNull();
    // Its from-set is exactly every non-terminal state.
    expect([...(TRANSITIONS.abandon.from as DesignState[])].sort()).toEqual(
      DESIGN_STATES.filter(
        (state) =>
          state !== 'abandoned' &&
          state !== 'execution' &&
          state !== 'closed_design_only',
      ).sort(),
    );

    // NO edge routes through the fail-closed `pendingGuard` sentinel any more.
    // This is the runtime witness for "declared but unfireable is now empty": if
    // a future step parks a new trigger on the sentinel it must ALSO be kept out
    // of WIRED_TRIGGERS, and this assertion is what forces that pairing.
    const onSentinel = ALL_TRIGGERS.filter((trigger) =>
      TRANSITIONS[trigger].guards.includes('pendingGuard'),
    );
    expect(onSentinel).toEqual([]);
  });
});
