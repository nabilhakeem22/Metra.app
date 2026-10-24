import { describe, expect, it } from 'vitest';
import {
  EXECUTION_NEXT_ACTION_KINDS,
  EXECUTION_STAGES,
  executionStage,
  type ExecutionNextActionKind,
  type ExecutionStage,
} from '@/lib/execution/stage';
import { buildPhaseView } from '../build-view';
import { EXECUTION_PHASE } from '../phases/execution';
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

const CLIENT_KINDS: ReadonlySet<ExecutionNextActionKind> = new Set([
  'record_signed_offline',
  'record_payment',
  'await_variation_answer',
]);

describe('locateExecutionForStudio', () => {
  it('puts every stage, with every next action or none, on exactly one step with one whose-move', () => {
    for (const stage of EXECUTION_STAGES) {
      for (const kind of [...EXECUTION_NEXT_ACTION_KINDS, null]) {
        const at = locateExecutionForStudio({ stage, next: kind === null ? null : { kind } });
        expect(at.step, `${stage}/${kind}`).toBe(EXPECTED_STEP[stage]);
        // The view builds without throwing, so the step is one the phase has.
        const view = buildPhaseView(EXECUTION_PHASE, at, 'studio');
        expect(view.steps.filter((step) => step.status === 'current').length, stage).toBe(at.status === 'active' ? 1 : 0);
        if (at.status !== 'active' || kind === null) expect(at.whoseMove, `${stage}/${kind}`).toBeNull();
        else expect(at.whoseMove, `${stage}/${kind}`).toBe(CLIENT_KINDS.has(kind) ? 'client' : 'studio');
      }
    }
  });

  it('completes the phase once settled and closes it once terminated', () => {
    expect(locateExecutionForStudio({ stage: 'settled', next: null })).toEqual({
      step: 'settled',
      whoseMove: null,
      status: 'complete',
    });
    expect(locateExecutionForStudio({ stage: 'terminated', next: null })).toEqual({
      step: null,
      whoseMove: null,
      status: 'closed',
    });
  });

  it('reads the derived stage: a sent contract waits on the client signature', () => {
    const result = executionStage({
      hasIssuedBoq: true,
      contract: {
        status: 'issued',
        scheduleValid: true,
        nextUnbilledMilestone: null,
        pendingClaimCount: 0,
        unbilledVariationCount: 0,
        finalAccountOutstanding: null,
        unpaidRequestCount: 0,
        openVariationCount: 0,
        billingBalance: '0',
        finalAccountBalance: '0',
      },
    });
    expect(locateExecutionForStudio(result)).toEqual({ step: 'signature', whoseMove: 'client', status: 'active' });
  });

  it('gives the studio the move while it has the BOQ, the contract or a claim to deal with', () => {
    expect(locateExecutionForStudio({ stage: 'no_boq', next: { kind: 'open_boq' } }).whoseMove).toBe('studio');
    expect(locateExecutionForStudio({ stage: 'draft', next: { kind: 'set_schedule' } }).whoseMove).toBe('studio');
    expect(
      locateExecutionForStudio({ stage: 'in_progress', next: { kind: 'review_payment_claim' } }).whoseMove,
    ).toBe('studio');
  });
});
