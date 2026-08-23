import { describe, expect, it } from 'vitest';
import { canRunTrigger, legalTriggersFrom, triggerNeedsForm } from './ui';

describe('legalTriggersFrom', () => {
  it('offers only the wired trigger legal from a given state', () => {
    expect(legalTriggersFrom('created')).toEqual(['submitDesignFee']);
    expect(legalTriggersFrom('design_proposal')).toEqual(['confirmAndPayDeposit']);
    expect(legalTriggersFrom('survey')).toEqual(['spatialBaseReady']);
    expect(legalTriggersFrom('layout')).toEqual(['optionsReady']);
    expect(legalTriggersFrom('concept_review')).toEqual(['selectConcept']);
    expect(legalTriggersFrom('design_3d')).toEqual(['rendersReady']);
  });

  it('offers the self-loop and exit together from negotiation', () => {
    expect(legalTriggersFrom('negotiation').sort()).toEqual(
      ['confirmConcept', 'requestRevision'].sort(),
    );
  });

  it('offers the Gate-B fan-out from final_approval', () => {
    expect(legalTriggersFrom('final_approval').sort()).toEqual(
      ['approveDesign', 'attestAsBuiltClean', 'flagAsBuiltVariance', 'rejectDesign'].sort(),
    );
  });

  it('offers nothing from a terminal state', () => {
    expect(legalTriggersFrom('execution')).toEqual([]);
    expect(legalTriggersFrom('closed_design_only')).toEqual([]);
    expect(legalTriggersFrom('abandoned')).toEqual([]);
  });

  it('offers nothing from a not-yet-wired active state (shop_drawings)', () => {
    // draftReady is declared but not wired — it must not surface as a next action.
    expect(legalTriggersFrom('shop_drawings')).toEqual([]);
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
});
