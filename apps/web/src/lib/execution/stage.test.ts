import { describe, expect, it } from 'vitest';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { billingBalance, computeFinalAccount, type FinalAccountInput } from './money/final-account';
import { milestoneAmounts, type MilestoneAmount } from './money/milestone-amounts';
import type { CleanScheduleRow } from './money/schedule';
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
    nextUnbilledMilestone: null,
    pendingClaimCount: 0,
    unbilledVariationCount: 0,
    finalAccountOutstanding: null,
    unpaidRequestCount: 0,
    openVariationCount: 0,
    billingBalance: '0',
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
    withContract({ pendingClaimCount: 1, nextUnbilledMilestone: { id: 'm2', amount: '37200' }, unpaidRequestCount: 1 }),
    { stage: 'in_progress', next: { kind: 'review_payment_claim' } },
  ],
  [
    'a milestone to bill',
    withContract({
      nextUnbilledMilestone: { id: 'm2', amount: '62000' },
      unbilledVariationCount: 1,
      unpaidRequestCount: 1,
      billingBalance: '62000',
      finalAccountBalance: '62000',
    }),
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
  [
    'R1: final account issued, then a request voided under it',
    withContract({ finalAccountOutstanding: '0', billingBalance: '24800.0000', finalAccountBalance: '24800.0000' }),
    { stage: 'final_account', next: { kind: 'review_final_account' } },
  ],
  ['final account paid, nothing owed', withContract({ finalAccountOutstanding: '0' }), { stage: 'settled', next: null }],
  ['terminated', withContract({ status: 'terminated', ...FINAL_ISSUED }), { stage: 'terminated', next: null }],
];

/** Every combination of the facts that decide a signed contract's stage. */
function signedGrid(): ExecutionContractFacts[] {
  const grid: ExecutionContractFacts[] = [];
  for (const finalAccountOutstanding of [null, '0', '100'])
    for (const nextUnbilledMilestone of [null, { id: 'm1', amount: '50' }])
      for (const pendingClaimCount of [0, 1])
        for (const unbilledVariationCount of [0, 1])
          for (const unpaidRequestCount of [0, 1])
            for (const openVariationCount of [0, 1])
              for (const billingBalance of ['-50', '0', '50'])
                for (const finalAccountBalance of ['-50', '0', '50']) {
                grid.push(contract({
                  finalAccountOutstanding, nextUnbilledMilestone, pendingClaimCount,
                  unbilledVariationCount, unpaidRequestCount, openVariationCount, billingBalance, finalAccountBalance,
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
      expect(facts.unbilledVariationCount).toBe(0);
    }
  });

  it('R1: is never settled while the final account balance is above 0', () => {
    for (const facts of signedGrid()) {
      if (stageOf(facts).stage === 'settled') expect(parseMoney4(facts.finalAccountBalance) <= 0n).toBe(true);
    }
  });

  it('R2: suggests a milestone only while the balance still covers it', () => {
    for (const facts of signedGrid()) {
      if (stageOf(facts).next?.kind !== 'send_milestone_request') continue;
      expect(parseMoney4(facts.nextUnbilledMilestone!.amount) <= parseMoney4(facts.billingBalance)).toBe(true);
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

  describe('R2: 50/30/20 on 124,000 after a de-scope', () => {
    const schedule: CleanScheduleRow[] = ['50', '30', '20'].map((value, sortOrder) => ({
      labelAr: 'دفعة', labelEn: null, basis: 'percent', value, sortOrder,
    }));
    const [first, second, third] = milestoneAmounts(schedule, '124000', '14000');

    /** The facts once the given milestones are requested and paid, with this de-scope approved. */
    function factsAfter(requested: MilestoneAmount[], netDelta: string, next: MilestoneAmount): ExecutionContractFacts {
      const { balance } = computeFinalAccount({
        originalValue: '124000', taxRate: '14', supervisionPct: '10', discountPct: '0',
        approvedVariationNetDeltas: [netDelta], measuredLines: [],
        issuedRequestsTotal: formatMoney4(requested.reduce((sum, row) => sum + parseMoney4(row.amount), 0n)),
      });
      // No measurements here, so the steering and the full balance agree.
      return contract({
        nextUnbilledMilestone: { id: 'next', amount: next.amount },
        billingBalance: balance,
        finalAccountBalance: balance,
      });
    }

    it('the milestones are 62,000, 37,200 and 24,800', () => {
      expect([first.amount, second.amount, third.amount]).toEqual(['62000.0000', '37200.0000', '24800.0000']);
    });

    it('a -20,000 de-scope (charge -24,800) absorbs the last milestone: settled, nothing suggested', () => {
      const facts = factsAfter([first, second], '-20000', third);
      expect(facts.finalAccountBalance).toBe('0.0000');
      expect(stageOf(facts)).toEqual({ stage: 'settled', next: null });
    });

    it('while the balance still covers the next milestone it is suggested', () => {
      const facts = factsAfter([first], '-20000', second);
      // 124,000 - 24,800 - 62,000 = 37,200, exactly the second milestone
      expect(facts.finalAccountBalance).toBe('37200.0000');
      expect(stageOf(facts).next).toEqual({ kind: 'send_milestone_request' });
    });

    it('a balance above 0 but below the next milestone suggests the final account instead', () => {
      // -10,000 de-scope: charge -12,400, leaving 12,400 against a 24,800 milestone
      const facts = factsAfter([first, second], '-10000', third);
      expect(facts.finalAccountBalance).toBe('12400.0000');
      expect(stageOf(facts)).toEqual({ stage: 'in_progress', next: { kind: 'prepare_final_account' } });
    });

    it('a de-scope larger than the unbilled milestone surfaces the refund', () => {
      const facts = factsAfter([first, second], '-30000', third);
      // 124,000 - 37,200 - 99,200 = -12,400
      expect(stageOf(facts)).toEqual({ stage: 'settled', next: { kind: 'refund_due', amount: '12400.0000' } });
    });
  });

  describe('R4: a mid-job measurement never steers the card', () => {
    // 124,000; a provisional line of 1,000 at 100 read at 100; 62,000 issued and paid.
    const midJob: FinalAccountInput = {
      originalValue: '124000', taxRate: '14', supervisionPct: '10', discountPct: '0',
      approvedVariationNetDeltas: [],
      measuredLines: [{
        lineId: 'p', qty: '1000', unitPrice: '100', discountPct: '0', provisional: true,
        measuredQty: '100', variationQty: '0',
      }],
      issuedRequestsTotal: '62000',
    };
    const nextMilestone = { id: 'm2', amount: '37200.0000' };

    it('steering on billingBalance suggests the next milestone, though the full balance is negative', () => {
      const facts = contract({
        nextUnbilledMilestone: nextMilestone,
        billingBalance: billingBalance(midJob),
        finalAccountBalance: computeFinalAccount(midJob).balance,
      });
      expect(facts.finalAccountBalance).toBe('-49600.0000');
      expect(stageOf(facts)).toEqual({ stage: 'in_progress', next: { kind: 'send_milestone_request' } });
    });
  });

  describe('the end state reads the full balance, measurements included', () => {
    // Fully billed and paid at 124,000; a provisional line of 200 at 100 measured at 240.
    const overMeasured: FinalAccountInput = {
      originalValue: '124000', taxRate: '14', supervisionPct: '10', discountPct: '0',
      approvedVariationNetDeltas: [],
      measuredLines: [{
        lineId: 'p', qty: '200', unitPrice: '100', discountPct: '0', provisional: true,
        measuredQty: '240', variationQty: '0',
      }],
      issuedRequestsTotal: '124000',
    };

    it('a fully billed job with an over-measured provisional line prepares the final account', () => {
      const facts = contract({
        billingBalance: billingBalance(overMeasured),
        finalAccountBalance: computeFinalAccount(overMeasured).balance,
      });
      expect([facts.billingBalance, facts.finalAccountBalance]).toEqual(['0.0000', '4960.0000']);
      expect(stageOf(facts)).toEqual({ stage: 'in_progress', next: { kind: 'prepare_final_account' } });
    });

    it('an under-measured one surfaces the refund, and an exact one settles', () => {
      const under = { ...overMeasured, measuredLines: [{ ...overMeasured.measuredLines[0], measuredQty: '180' }] };
      const exact = { ...overMeasured, measuredLines: [{ ...overMeasured.measuredLines[0], measuredQty: '200' }] };
      const factsOf = (input: FinalAccountInput) =>
        contract({ billingBalance: billingBalance(input), finalAccountBalance: computeFinalAccount(input).balance });
      expect(stageOf(factsOf(under))).toEqual({ stage: 'settled', next: { kind: 'refund_due', amount: '2480.0000' } });
      expect(stageOf(factsOf(exact))).toEqual({ stage: 'settled', next: null });
    });
  });
});
