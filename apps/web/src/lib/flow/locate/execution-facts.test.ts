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
      ['more issued change orders than open ones', withContract({}, { issuedChangeOrderCount: 1 }), /exceeds openVariationCount/],
      ['more unclaimed requests than unpaid ones', withContract({}, { unclaimedDueRequestCount: 1 }), /disagrees/],
      [
        'unpaid requests neither claimed nor unclaimed',
        withContract({ unpaidRequestCount: 2, pendingClaimCount: 1 }, { unclaimedDueRequestCount: 0 }),
        /disagrees/,
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

  it('takes the step from the contract stage', () => {
    expect(executionPosition(flowFactsOf(model({ contract: 'issued_open' })))).toEqual({
      result: { stage: 'awaiting_signature', next: { kind: 'record_signed_offline' } },
      step: 'signature',
      status: 'active',
    });
  });
});
