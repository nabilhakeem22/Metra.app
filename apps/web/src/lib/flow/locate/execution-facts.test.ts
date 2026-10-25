import { describe, expect, it } from 'vitest';
import type { ExecutionContractFacts } from '@/lib/execution/stage';
import { flowFactsOf, model } from '@/test/execution-flow-model';
import { executionPosition, type ExecutionFlowFacts } from './execution-facts';
import { locateExecutionForClient } from './execution-client';
import { locateExecutionForStudio } from './execution-studio';

const SIGNED = flowFactsOf(model());

function withContract(overrides: Partial<ExecutionContractFacts>, facts: Partial<ExecutionFlowFacts> = {}): ExecutionFlowFacts {
  const contract = { ...(SIGNED.stage.contract as ExecutionContractFacts), ...overrides };
  return { ...SIGNED, ...facts, stage: { hasIssuedBoq: true, contract } };
}

describe('executionPosition', () => {
  it('refuses facts no query can produce, on both sides (F8)', () => {
    const refused: [string, ExecutionFlowFacts, RegExp][] = [
      ['a negative count', withContract({ pendingClaimCount: -1 }), /pendingClaimCount is not a count/],
      ['a fractional count', withContract({ openVariationCount: 0.5 }), /openVariationCount is not a count/],
      ['NaN', withContract({}, { issuedChangeOrderCount: Number.NaN }), /issuedChangeOrderCount is not a count/],
      ['more issued change orders than open ones', withContract({}, { issuedChangeOrderCount: 1 }), /exceed openVariationCount/],
      ['NaN expired change orders', withContract({}, { expiredChangeOrderCount: Number.NaN }), /expiredChangeOrderCount is not a count/],
      [
        'more issued and expired change orders than open ones',
        withContract({ openVariationCount: 1 }, { issuedChangeOrderCount: 1, expiredChangeOrderCount: 1 }),
        /exceed openVariationCount/,
      ],
      ['more unclaimed requests than unpaid ones', withContract({}, { unclaimedDueRequestCount: 1 }), /disagrees/],
      [
        'unpaid requests neither claimed nor unclaimed',
        withContract({ unpaidRequestCount: 2, pendingClaimCount: 1 }, { unclaimedDueRequestCount: 0 }),
        /disagrees/,
      ],
      // F3: the inputs only an untyped path (H4's SDF JSON) can bring.
      ['a balance that is not a number', withContract({ finalAccountBalance: 'abc' }), /finalAccountBalance is not a money figure/],
      ['a billing balance that is not a number', withContract({ billingBalance: '' }), /billingBalance is not a money figure/],
      ['an outstanding that is not a number', withContract({ finalAccountOutstanding: '1,000' }), /finalAccountOutstanding is not a money figure/],
      [
        'a milestone amount that is not a number',
        withContract({ nextUnbilledMilestone: { id: 'row-1', amount: 'NaN' } }),
        /nextUnbilledMilestone.amount is not a money figure/,
      ],
      ['a number where a figure is expected', withContract({ billingBalance: 0 as unknown as string }), /billingBalance is not a money figure/],
      ['signingOpen as the string "false"', withContract({}, { signingOpen: 'false' as unknown as boolean }), /signingOpen is not a boolean/],
      ['signingOpen missing', withContract({}, { signingOpen: undefined as unknown as boolean }), /signingOpen is not a boolean/],
      ['a draft contract with unpaid requests', withContract({ status: 'draft', unpaidRequestCount: 1 }, { unclaimedDueRequestCount: 1 }), /a draft contract carries/],
      ['a draft contract with a pending claim', withContract({ status: 'draft', pendingClaimCount: 1 }), /a draft contract carries/],
      [
        'a draft contract with an expired change order',
        withContract({ status: 'draft', openVariationCount: 1 }, { expiredChangeOrderCount: 1 }),
        /a draft contract carries/,
      ],
      [
        'an unknown contract status',
        withContract({ status: 'superseded' as ExecutionContractFacts['status'] }),
        /unknown contract status/,
      ],
    ];
    for (const [label, facts, message] of refused) {
      expect(() => executionPosition(facts), label).toThrow(message);
      expect(() => locateExecutionForStudio(facts), label).toThrow(message);
      expect(() => locateExecutionForClient(facts), label).toThrow(message);
    }
  });

  it('accepts the figures Postgres renders, a negative balance included', () => {
    for (const balance of ['0', '0.0000', '1000.0000', '-250.5000', '62000']) {
      expect(() => executionPosition(withContract({ billingBalance: balance, finalAccountBalance: balance })), balance).not.toThrow();
    }
    expect(() => executionPosition(withContract({ status: 'draft' }))).not.toThrow();
  });

  it('takes the step from the contract stage', () => {
    expect(executionPosition(flowFactsOf(model({ contract: 'issued_open' })))).toEqual({
      result: { stage: 'awaiting_signature', next: { kind: 'record_signed_offline' } },
      step: 'signature',
      status: 'active',
    });
  });
});
