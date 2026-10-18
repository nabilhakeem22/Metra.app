import { describe, expect, it } from 'vitest';
import {
  EXECUTION_NEXT_ACTIONS,
  EXECUTION_STAGES,
  executionStage,
  type ExecutionContractFacts,
  type ExecutionFacts,
  type ExecutionStage,
} from './stage';

function contract(overrides: Partial<ExecutionContractFacts> = {}): ExecutionContractFacts {
  return {
    status: 'signed',
    scheduleValid: true,
    nextUnbilledMilestoneId: null,
    pendingClaimCount: 0,
    unbilledVariationCount: 0,
    finalAccountOutstanding: null,
    unpaidRequestCount: 1,
    openVariationCount: 0,
    finalAccountBalance: '4960.0000',
    ...overrides,
  };
}

function withContract(overrides: Partial<ExecutionContractFacts>): ExecutionFacts {
  return { hasIssuedBoq: true, contract: contract(overrides) };
}

/** One set of facts per situation the cockpit can meet, named for what it shows. */
const situations: Record<string, ExecutionFacts> = {
  'no BOQ in Metra': { hasIssuedBoq: false, contract: null },
  'an issued BOQ, no contract': { hasIssuedBoq: true, contract: null },
  'a draft with no valid schedule': withContract({ status: 'draft', scheduleValid: false }),
  'a draft ready to send': withContract({ status: 'draft' }),
  'sent, not signed': withContract({ status: 'issued' }),
  'signed, a milestone to bill': withContract({ nextUnbilledMilestoneId: 'm2' }),
  'signed, a claim pending': withContract({ pendingClaimCount: 1, nextUnbilledMilestoneId: 'm2' }),
  'signed, a change order to bill': withContract({ unbilledVariationCount: 2 }),
  'signed, everything billed': withContract({}),
  'final account outstanding': withContract({ finalAccountOutstanding: '4960.0000' }),
  'final account with a claim': withContract({ finalAccountOutstanding: '4960.0000', pendingClaimCount: 1 }),
  'final account paid': withContract({ finalAccountOutstanding: '0.0000' }),
  'everything paid, nothing left to bill': withContract({ unpaidRequestCount: 0, finalAccountBalance: '0.0000' }),
  terminated: withContract({ status: 'terminated', finalAccountOutstanding: '4960.0000' }),
};

describe('executionStage', () => {
  it('reaches every stage', () => {
    const reached = new Set(Object.values(situations).map((facts) => executionStage(facts).stage));
    expect([...reached].sort()).toEqual([...EXECUTION_STAGES].sort());
  });

  it('produces every next action the card has to render', () => {
    const produced = new Set(Object.values(situations).map((facts) => executionStage(facts).next));
    produced.delete(null);
    expect([...produced].sort()).toEqual([...EXECUTION_NEXT_ACTIONS].sort());
  });

  it('gives each live stage exactly one next action, and none once settled or terminated', () => {
    const finished: ExecutionStage[] = ['settled', 'terminated'];
    for (const facts of Object.values(situations)) {
      const { stage, next } = executionStage(facts);
      if (finished.includes(stage)) expect(next).toBeNull();
      else expect(EXECUTION_NEXT_ACTIONS).toContain(next);
    }
  });

  it.each([
    ['no BOQ in Metra', 'no_boq', 'open_boq'],
    ['an issued BOQ, no contract', 'no_contract', 'create_contract'],
    ['a draft with no valid schedule', 'draft', 'set_schedule'],
    ['a draft ready to send', 'draft', 'send_contract'],
    ['sent, not signed', 'awaiting_signature', 'record_signed_offline'],
    ['signed, a milestone to bill', 'in_progress', 'send_milestone_request'],
    ['signed, a claim pending', 'in_progress', 'review_payment_claim'],
    ['signed, a change order to bill', 'in_progress', 'send_variation_request'],
    ['signed, everything billed', 'in_progress', 'prepare_final_account'],
    ['final account outstanding', 'final_account', 'record_payment'],
    ['final account with a claim', 'final_account', 'review_payment_claim'],
    ['final account paid', 'settled', null],
    ['everything paid, nothing left to bill', 'settled', null],
    ['terminated', 'terminated', null],
  ] as const)('%s -> %s, next %s', (situation, stage, next) => {
    expect(executionStage(situations[situation])).toEqual({ stage, next });
  });

  it('bills milestones before change orders', () => {
    const facts = withContract({ nextUnbilledMilestoneId: 'm1', unbilledVariationCount: 1 });
    expect(executionStage(facts).next).toBe('send_milestone_request');
  });

  it('a terminated contract is terminated whatever else is true', () => {
    for (const overrides of [{}, { scheduleValid: false }, { pendingClaimCount: 3 }, { finalAccountOutstanding: '0' }]) {
      expect(executionStage(withContract({ ...overrides, status: 'terminated' })).stage).toBe('terminated');
    }
  });

  describe('settling without a final account request', () => {
    const paidUp = { unpaidRequestCount: 0, openVariationCount: 0, pendingClaimCount: 0, finalAccountBalance: '0' };

    it('settles when everything is paid and the balance is zero or below', () => {
      expect(executionStage(withContract(paidUp)).stage).toBe('settled');
      expect(executionStage(withContract({ ...paidUp, finalAccountBalance: '-2480.0000' }))).toEqual({
        stage: 'settled',
        next: null,
      });
    });

    it.each([
      ['a request is still unpaid', { unpaidRequestCount: 1 }, 'prepare_final_account'],
      ['a change order is open', { openVariationCount: 1 }, 'prepare_final_account'],
      ['a claim is pending', { pendingClaimCount: 1 }, 'review_payment_claim'],
      ['a final account would still bill', { finalAccountBalance: '0.0001' }, 'prepare_final_account'],
    ] as const)('stays in progress when %s', (_reason, overrides, next) => {
      expect(executionStage(withContract({ ...paidUp, ...overrides }))).toEqual({ stage: 'in_progress', next });
    });

    it('an issued final account request still decides on its own outstanding', () => {
      const issued = { ...paidUp, finalAccountBalance: '0' };
      expect(executionStage(withContract({ ...issued, finalAccountOutstanding: '100' })).stage).toBe('final_account');
      expect(executionStage(withContract({ ...issued, finalAccountOutstanding: '0' })).stage).toBe('settled');
    });
  });
});
