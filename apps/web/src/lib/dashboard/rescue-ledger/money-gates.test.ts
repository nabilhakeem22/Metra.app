import { describe, expect, it } from 'vitest';
import { MONEY_GATES } from './money-gates';

// A2: the five money gates today, derived from the registry. If an edge gains
// or loses a milestone guard this list moves with it, and this test says so.
describe('MONEY_GATES', () => {
  it('is exactly the five milestone gates, each with the state it holds and the kind it clears', () => {
    expect([...MONEY_GATES].sort((a, b) => a.trigger.localeCompare(b.trigger))).toEqual([
      { trigger: 'approveDesign', gateState: 'final_approval', milestoneKind: 'gate_b' },
      { trigger: 'chooseDesignOnly', gateState: 'execution_decision', milestoneKind: 'balance' },
      { trigger: 'chooseExecution', gateState: 'execution_decision', milestoneKind: 'balance' },
      { trigger: 'confirmAndPayDeposit', gateState: 'design_proposal', milestoneKind: 'deposit' },
      { trigger: 'selectConcept', gateState: 'concept_review', milestoneKind: 'gate_a' },
    ]);
  });

  it('counts the deposit gate (owner decision D2)', () => {
    expect(MONEY_GATES.some((gate) => gate.milestoneKind === 'deposit')).toBe(true);
  });
});
