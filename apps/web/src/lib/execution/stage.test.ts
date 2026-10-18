import { describe, expect, it } from 'vitest';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import {
  EXECUTION_NEXT_ACTION_KINDS,
  EXECUTION_STAGES,
  executionStage,
  type ExecutionContractFacts,
  type ExecutionFacts,
  type ExecutionStageResult,
} from './stage';

/** A signed contract on which nothing is owed either way. */
function contract(overrides: Partial<ExecutionContractFacts> = {}): ExecutionContractFacts {
  return {
    status: 'signed',
    scheduleValid: true,
    nextUnbilledMilestoneId: null,
    pendingClaimCount: 0,
    unbilledVariationCount: 0,
    finalAccountOutstanding: null,
    unpaidRequestCount: 0,
    openVariationCount: 0,
    finalAccountBalance: '0',
    ...overrides,
  };
}

function withContract(overrides: Partial<ExecutionContractFacts>): ExecutionFacts {
  return { hasIssuedBoq: true, contract: contract(overrides) };
}

const FINAL_ISSUED = { finalAccountOutstanding: '4960.0000', unpaidRequestCount: 1 };

/** Each situation the cockpit can meet, and the stage and next action it must show. */
const situations: [string, ExecutionFacts, ExecutionStageResult][] = [
  ['no BOQ in Metra', { hasIssuedBoq: false, contract: null }, { stage: 'no_boq', next: { kind: 'open_boq' } }],
  ['an issued BOQ, no contract', { hasIssuedBoq: true, contract: null }, { stage: 'no_contract', next: { kind: 'create_contract' } }],
  ['a draft with no valid schedule', withContract({ status: 'draft', scheduleValid: false }), { stage: 'draft', next: { kind: 'set_schedule' } }],
  ['a draft ready to send', withContract({ status: 'draft' }), { stage: 'draft', next: { kind: 'send_contract' } }],
  ['sent, not signed', withContract({ status: 'issued' }), { stage: 'awaiting_signature', next: { kind: 'record_signed_offline' } }],
  [
    'a claim pending beside a milestone to bill',
    withContract({ pendingClaimCount: 1, nextUnbilledMilestoneId: 'm2', unpaidRequestCount: 1 }),
    { stage: 'in_progress', next: { kind: 'review_payment_claim' } },
  ],
  [
    'a milestone to bill',
    withContract({ nextUnbilledMilestoneId: 'm2', unbilledVariationCount: 1, unpaidRequestCount: 1, finalAccountBalance: '62000' }),
    { stage: 'in_progress', next: { kind: 'send_milestone_request' } },
  ],
  [
    'an approved change order to bill',
    withContract({ unbilledVariationCount: 2, unpaidRequestCount: 1, finalAccountBalance: '12400' }),
    { stage: 'in_progress', next: { kind: 'send_variation_request' } },
  ],
  [
    'F1: every milestone sent, the last one unpaid',
    withContract({ unpaidRequestCount: 1, openVariationCount: 1 }),
    { stage: 'in_progress', next: { kind: 'record_payment' } },
  ],
  [
    'F1: everything paid, a change order waiting on the client',
    withContract({ openVariationCount: 1, finalAccountBalance: '4960' }),
    { stage: 'in_progress', next: { kind: 'await_variation_answer' } },
  ],
  [
    'everything paid, measured works left to bill',
    withContract({ finalAccountBalance: '4960.0000' }),
    { stage: 'in_progress', next: { kind: 'prepare_final_account' } },
  ],
  ['everything paid, nothing left to bill', withContract({}), { stage: 'settled', next: null }],
  [
    'F5: everything paid, the client over-billed',
    withContract({ finalAccountBalance: '-13640.0000' }),
    { stage: 'settled', next: { kind: 'refund_due', amount: '13640.0000' } },
  ],
  ['final account outstanding', withContract(FINAL_ISSUED), { stage: 'final_account', next: { kind: 'record_payment' } }],
  [
    'final account with a claim',
    withContract({ ...FINAL_ISSUED, pendingClaimCount: 1 }),
    { stage: 'final_account', next: { kind: 'review_payment_claim' } },
  ],
  [
    'F2: final account paid, another request unpaid',
    withContract({ finalAccountOutstanding: '0', unpaidRequestCount: 1 }),
    { stage: 'final_account', next: { kind: 'record_payment' } },
  ],
  [
    'F2: final account paid, a claim pending',
    withContract({ finalAccountOutstanding: '0', pendingClaimCount: 1 }),
    { stage: 'final_account', next: { kind: 'review_payment_claim' } },
  ],
  ['final account paid, nothing owed', withContract({ finalAccountOutstanding: '0' }), { stage: 'settled', next: null }],
  ['terminated', withContract({ status: 'terminated', ...FINAL_ISSUED }), { stage: 'terminated', next: null }],
];

/** Every combination of the facts that decide a signed contract's stage. */
function signedGrid(): ExecutionContractFacts[] {
  const grid: ExecutionContractFacts[] = [];
  for (const finalAccountOutstanding of [null, '0', '100'])
    for (const nextUnbilledMilestoneId of [null, 'm1'])
      for (const pendingClaimCount of [0, 1])
        for (const unbilledVariationCount of [0, 1])
          for (const unpaidRequestCount of [0, 1])
            for (const openVariationCount of [0, 1])
              for (const finalAccountBalance of ['-50', '0', '50']) {
                grid.push(contract({
                  finalAccountOutstanding, nextUnbilledMilestoneId, pendingClaimCount,
                  unbilledVariationCount, unpaidRequestCount, openVariationCount, finalAccountBalance,
                }));
              }
  return grid;
}

const stageOf = (facts: ExecutionContractFacts) => executionStage({ hasIssuedBoq: true, contract: facts });

describe('executionStage', () => {
  it.each(situations)('%s', (_situation, facts, expected) => {
    expect(executionStage(facts)).toEqual(expected);
  });

  it('reaches every stage and produces every next action', () => {
    const results = situations.map(([, facts]) => executionStage(facts));
    expect(new Set(results.map((result) => result.stage))).toEqual(new Set(EXECUTION_STAGES));
    const kinds = new Set(results.flatMap((result) => (result.next ? [result.next.kind] : [])));
    expect(kinds).toEqual(new Set(EXECUTION_NEXT_ACTION_KINDS));
  });

  it('gives each live stage exactly one next action; settled only a refund', () => {
    for (const facts of signedGrid()) {
      const { stage, next } = stageOf(facts);
      if (stage === 'settled') expect(next === null || next.kind === 'refund_due').toBe(true);
      else expect(EXECUTION_NEXT_ACTION_KINDS).toContain(next?.kind);
    }
  });

  it('offers prepare_final_account only when the final account core would accept it', () => {
    for (const facts of signedGrid()) {
      if (stageOf(facts).next?.kind !== 'prepare_final_account') continue;
      expect(parseMoney4(facts.finalAccountBalance) > 0n).toBe(true);
      expect(facts.openVariationCount).toBe(0);
      expect(facts.finalAccountOutstanding).toBeNull();
    }
  });

  it('is never settled while money is owed either way or a decision waits', () => {
    for (const facts of signedGrid()) {
      if (stageOf(facts).stage !== 'settled') continue;
      expect(facts.unpaidRequestCount + facts.pendingClaimCount + facts.openVariationCount).toBe(0);
      expect(parseMoney4(facts.finalAccountOutstanding ?? '0') > 0n).toBe(false);
      // Without a final account request, nothing may be left to bill either. With
      // one, it billed whatever the schedule and the change orders had left.
      if (facts.finalAccountOutstanding !== null) continue;
      expect(facts.nextUnbilledMilestoneId).toBeNull();
      expect(facts.unbilledVariationCount).toBe(0);
      expect(parseMoney4(facts.finalAccountBalance) <= 0n).toBe(true);
    }
  });

  it('a refund is due only on a settled contract, for the size of the negative balance', () => {
    for (const facts of signedGrid()) {
      const { stage, next } = stageOf(facts);
      if (next?.kind !== 'refund_due') continue;
      expect(stage).toBe('settled');
      expect(facts.finalAccountBalance).toBe('-50');
      expect(next.amount).toBe('50.0000');
    }
  });

  it('a terminated contract is terminated whatever else is true', () => {
    for (const facts of signedGrid()) {
      expect(stageOf({ ...facts, status: 'terminated' })).toEqual({ stage: 'terminated', next: null });
    }
  });
});
