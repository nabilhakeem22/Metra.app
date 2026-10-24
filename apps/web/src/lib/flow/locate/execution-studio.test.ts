import { describe, expect, it } from 'vitest';
import { executionStage, type ExecutionNextActionKind, type ExecutionStage } from '@/lib/execution/stage';
import { executionModels, flowFactsOf, model } from '@/test/execution-flow-model';
import { locateExecutionForStudio } from './execution-studio';

const EXPECTED_STEP: Record<ExecutionStage, string | null> = {
  no_boq: 'contract',
  no_contract: 'contract',
  draft: 'contract',
  awaiting_signature: 'signature',
  in_progress: 'works',
  final_account: 'final_account',
  settled: 'settled',
  terminated: null,
};

const WAITS_ON_CLIENT: ReadonlySet<ExecutionNextActionKind> = new Set([
  'record_signed_offline',
  'record_payment',
  'await_variation_answer',
]);

describe('locateExecutionForStudio', () => {
  it('puts every reachable model on its stage step, with the next action naming whose move it is', () => {
    for (const m of executionModels(2)) {
      const facts = flowFactsOf(m);
      const { stage, next } = executionStage(facts.stage);
      const at = locateExecutionForStudio(facts);
      const label = JSON.stringify(m);
      expect(at.step, label).toBe(EXPECTED_STEP[stage]);
      if (next === null) expect(at.whoseMove, label).toBeNull();
      else if (!WAITS_ON_CLIENT.has(next.kind)) expect(at.whoseMove, label).toBe('studio');
    }
  });

  it('completes the phase once settled and closes it once terminated', () => {
    expect(locateExecutionForStudio(flowFactsOf(model()))).toEqual({ step: 'settled', whoseMove: null, status: 'complete' });
    expect(locateExecutionForStudio(flowFactsOf(model({ contract: 'terminated' })))).toEqual({
      step: null,
      whoseMove: null,
      status: 'closed',
    });
  });

  it('waits on the client signature while the signing window is open, and on the studio once it has closed (F4)', () => {
    expect(locateExecutionForStudio(flowFactsOf(model({ contract: 'issued_open' })))).toEqual({
      step: 'signature',
      whoseMove: 'client',
      status: 'active',
    });
    expect(locateExecutionForStudio(flowFactsOf(model({ contract: 'issued_closed' }))).whoseMove).toBe('studio');
  });

  it('waits on the client for a change order issued to them, and on the studio for one it has not issued (F6)', () => {
    expect(locateExecutionForStudio(flowFactsOf(model({ issuedChangeOrders: 1 }))).whoseMove).toBe('client');
    expect(locateExecutionForStudio(flowFactsOf(model({ internalChangeOrders: 1 }))).whoseMove).toBe('studio');
    expect(locateExecutionForStudio(flowFactsOf(model({ issuedChangeOrders: 1, internalChangeOrders: 1 }))).whoseMove).toBe(
      'studio',
    );
  });

  it('waits on the client for a payment with no claim, and gives the studio a claim to review', () => {
    const due = { kind: 'milestone', state: 'due' } as const;
    expect(locateExecutionForStudio(flowFactsOf(model({ requests: [due] }))).whoseMove).toBe('client');
    const claimed = { kind: 'milestone', state: 'claimed' } as const;
    expect(locateExecutionForStudio(flowFactsOf(model({ requests: [claimed, due] }))).whoseMove).toBe('studio');
  });

  it('gives the studio the move while it has the BOQ, the contract or the billing to deal with', () => {
    for (const contract of ['no_boq', 'no_contract', 'draft_unscheduled', 'draft'] as const) {
      expect(locateExecutionForStudio(flowFactsOf(model({ contract }))), contract).toEqual({
        step: 'contract',
        whoseMove: 'studio',
        status: 'active',
      });
    }
    expect(locateExecutionForStudio(flowFactsOf(model({ nextMilestone: true, balanceLeft: true }))).whoseMove).toBe('studio');
  });
});
