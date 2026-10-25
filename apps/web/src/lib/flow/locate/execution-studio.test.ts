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
      // A wait is taken back only from the client, so only by the studio, and only on a client wait.
      if (at.takenBack !== null) {
        expect(at.whoseMove, label).toBe('studio');
        expect(next !== null && WAITS_ON_CLIENT.has(next.kind), label).toBe(true);
      }
    }
  });

  it('completes the phase once settled and closes it once terminated', () => {
    expect(locateExecutionForStudio(flowFactsOf(model()))).toEqual({ step: 'settled', whoseMove: null, status: 'complete', takenBack: null });
    expect(locateExecutionForStudio(flowFactsOf(model({ contract: 'terminated' })))).toEqual({
      step: null,
      whoseMove: null,
      status: 'closed',
      takenBack: null,
    });
  });

  it('waits on the client signature while the signing window is open, and on the studio once it has closed (F4)', () => {
    expect(locateExecutionForStudio(flowFactsOf(model({ contract: 'issued_open' })))).toEqual({
      step: 'signature',
      whoseMove: 'client',
      status: 'active',
      takenBack: null,
    });
    expect(locateExecutionForStudio(flowFactsOf(model({ contract: 'issued_closed' })))).toMatchObject({
      whoseMove: 'studio',
      takenBack: 'signing_closed',
    });
  });

  it('waits on the client for a change order issued to them, and on the studio for one it has not issued (F6)', () => {
    const at = (overrides: Parameters<typeof model>[0]) => locateExecutionForStudio(flowFactsOf(model(overrides)));
    expect(at({ issuedChangeOrders: 1 })).toMatchObject({ whoseMove: 'client', takenBack: null });
    expect(at({ internalChangeOrders: 1 })).toMatchObject({ whoseMove: 'studio', takenBack: 'change_order_not_issued' });
    expect(at({ issuedChangeOrders: 1, internalChangeOrders: 1 })).toMatchObject({ whoseMove: 'studio', takenBack: 'change_order_not_issued' });
  });

  it('takes back a change order whose link expired: the client can no longer answer it (F1)', () => {
    const at = (overrides: Parameters<typeof model>[0]) => locateExecutionForStudio(flowFactsOf(model(overrides)));
    expect(at({ expiredChangeOrders: 1 })).toMatchObject({ step: 'works', whoseMove: 'studio', takenBack: 'change_order_link_expired' });
    // Beside a live one too: the expired one still needs the studio.
    expect(at({ issuedChangeOrders: 1, expiredChangeOrders: 1 })).toMatchObject({ whoseMove: 'studio', takenBack: 'change_order_link_expired' });
    // One still to issue comes first: issuing is the act the studio can take in the app.
    expect(at({ internalChangeOrders: 1, expiredChangeOrders: 1 })).toMatchObject({ takenBack: 'change_order_not_issued' });
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
        takenBack: null,
      });
    }
    expect(locateExecutionForStudio(flowFactsOf(model({ nextMilestone: true, balanceLeft: true }))).whoseMove).toBe('studio');
  });
});
