import { describe, expect, it } from 'vitest';
import { canRunTrigger, legalTriggersFrom, triggerNeedsForm } from './ui';

describe('legalTriggersFrom', () => {
  it('offers the wired forward trigger plus the abandon off-ramp from each state', () => {
    // abandon (tail wiring) is legal from every non-terminal state, so each
    // single-path stage now offers its forward trigger + abandon.
    expect(legalTriggersFrom('created').sort()).toEqual(
      ['submitDesignFee', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('design_proposal').sort()).toEqual(
      ['confirmAndPayDeposit', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('survey').sort()).toEqual(
      ['spatialBaseReady', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('layout').sort()).toEqual(
      ['optionsReady', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('concept_review').sort()).toEqual(
      ['selectConcept', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('design_3d').sort()).toEqual(
      ['rendersReady', 'abandon'].sort(),
    );
  });

  it('offers the self-loop and exit together from negotiation', () => {
    expect(legalTriggersFrom('negotiation').sort()).toEqual(
      ['confirmConcept', 'requestRevision', 'abandon'].sort(),
    );
  });

  it('offers the Gate-B fan-out from final_approval', () => {
    expect(legalTriggersFrom('final_approval').sort()).toEqual(
      [
        'approveDesign',
        'attestAsBuiltClean',
        'flagAsBuiltVariance',
        'rejectDesign',
        'abandon',
      ].sort(),
    );
  });

  it('offers the tail edges from shop_drawings / boq / execution_decision / design_only_handoff', () => {
    expect(legalTriggersFrom('shop_drawings').sort()).toEqual(
      ['draftReady', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('boq').sort()).toEqual(
      ['finalizeBOQ', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('execution_decision').sort()).toEqual(
      ['chooseDesignOnly', 'chooseExecution', 'abandon'].sort(),
    );
    expect(legalTriggersFrom('design_only_handoff').sort()).toEqual(
      ['recipientAcknowledges', 'abandon'].sort(),
    );
  });

  it('offers nothing from a terminal state', () => {
    expect(legalTriggersFrom('execution')).toEqual([]);
    expect(legalTriggersFrom('closed_design_only')).toEqual([]);
    expect(legalTriggersFrom('abandoned')).toEqual([]);
  });
});

describe('triggerNeedsForm', () => {
  it('marks the payload triggers and only those', () => {
    expect(triggerNeedsForm('submitDesignFee')).toBe(true);
    expect(triggerNeedsForm('requestRevision')).toBe(true);
    expect(triggerNeedsForm('confirmAndPayDeposit')).toBe(false);
    expect(triggerNeedsForm('approveDesign')).toBe(false);
  });
});

describe('canRunTrigger', () => {
  it('gates the finance-family trigger to finance roles', () => {
    // confirmAndPayDeposit is engagements_finance (update): accountant yes, PM no.
    expect(canRunTrigger('accountant', 'confirmAndPayDeposit')).toBe(true);
    expect(canRunTrigger('project_manager', 'confirmAndPayDeposit')).toBe(false);
  });

  it('gates design-family triggers to design roles', () => {
    expect(canRunTrigger('project_manager', 'submitDesignFee')).toBe(true);
    expect(canRunTrigger('accountant', 'submitDesignFee')).toBe(false);
    expect(canRunTrigger('viewer', 'approveDesign')).toBe(false);
  });

  it('gates the issue-family recipientAcknowledges to owner/admin (approve)', () => {
    expect(canRunTrigger('owner', 'recipientAcknowledges')).toBe(true);
    expect(canRunTrigger('admin', 'recipientAcknowledges')).toBe(true);
    expect(canRunTrigger('project_manager', 'recipientAcknowledges')).toBe(false);
    expect(canRunTrigger('accountant', 'recipientAcknowledges')).toBe(false);
  });
});
