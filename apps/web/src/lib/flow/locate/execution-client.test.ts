import { describe, expect, it } from 'vitest';
import type { ExecutionContractFacts } from '@/lib/execution/stage';
import { flowFactsOf, model, type ExecutionModel, type ModelRequest } from '@/test/execution-flow-model';
import { buildPhaseView } from '../build-view';
import { EXECUTION_PHASE } from '../phases/execution';
import { CLIENT_EXECUTION_REASONS, locateExecutionForClient, type ClientExecutionReason } from './execution-client';
import { locateExecutionForStudio } from './execution-studio';

const DUE: ModelRequest = { kind: 'milestone', state: 'due' };
const CLAIMED: ModelRequest = { kind: 'milestone', state: 'claimed' };
const PAID: ModelRequest = { kind: 'milestone', state: 'paid' };
const FINAL_DUE: ModelRequest = { kind: 'final_account', state: 'due' };
const FINAL_CLAIMED: ModelRequest = { kind: 'final_account', state: 'claimed' };
const FINAL_PAID: ModelRequest = { kind: 'final_account', state: 'paid' };

const locate = (overrides: Partial<ExecutionModel>) => locateExecutionForClient(flowFactsOf(model(overrides)));

/** One model per reason: the facts, and the step and whose move the client must be shown. */
const FIXTURES: Record<ClientExecutionReason, [Partial<ExecutionModel>, string | null, string | null]> = {
  preparing_contract: [{ contract: 'draft' }, 'contract', 'studio'],
  sign_contract: [{ contract: 'issued_open' }, 'signature', 'client'],
  signing_closed: [{ contract: 'issued_closed' }, 'signature', 'studio'],
  decide_change_order: [{ requests: [DUE], issuedChangeOrders: 1 }, 'works', 'client'],
  pay_request: [{ requests: [DUE, PAID] }, 'works', 'client'],
  payment_being_confirmed: [{ requests: [CLAIMED, PAID] }, 'works', 'studio'],
  works_in_progress: [{ requests: [PAID], nextMilestone: true, balanceLeft: true }, 'works', 'site'],
  final_account_due: [{ requests: [FINAL_DUE, CLAIMED] }, 'final_account', 'client'],
  final_account_in_review: [{ requests: [FINAL_PAID], balanceLeft: true }, 'final_account', 'studio'],
  settled: [{ requests: [FINAL_PAID, PAID] }, 'settled', null],
  terminated: [{ contract: 'terminated', requests: [DUE], issuedChangeOrders: 1 }, null, null],
};

describe('locateExecutionForClient', () => {
  it('reaches every reason from a fixture, each on one step with one whose-move', () => {
    for (const reason of CLIENT_EXECUTION_REASONS) {
      const [overrides, step, whoseMove] = FIXTURES[reason];
      const at = locate(overrides);
      expect(at.reason, reason).toBe(reason);
      expect(at.step, reason).toBe(step);
      expect(at.whoseMove, reason).toBe(whoseMove);
      const view = buildPhaseView(EXECUTION_PHASE, at, 'client');
      expect(view.currentStep, reason).toBe(at.status === 'active' ? step : null);
    }
  });

  it('completes the phase when settled and closes it when terminated', () => {
    expect(locate(FIXTURES.settled[0]).status).toBe('complete');
    expect(locate(FIXTURES.terminated[0]).status).toBe('closed');
  });

  it('calls a job settled once nothing is owed either way, with or without a final account (F1)', () => {
    // A schedule that bills 100%, every instalment paid: no final account is ever needed.
    expect(locate({ requests: [PAID, PAID] })).toMatchObject({ reason: 'settled', step: 'settled', status: 'complete' });
  });

  it('never calls a job settled while the balance has grown back after its final account (F1)', () => {
    const at = locate({ requests: [FINAL_PAID, { kind: 'milestone', state: 'void' }], balanceLeft: true });
    expect(at).toMatchObject({ reason: 'final_account_in_review', step: 'final_account', whoseMove: 'studio' });
  });

  it('keeps the client on the final account once it is issued, whatever is due or claimed (F2)', () => {
    expect(locate({ requests: [FINAL_CLAIMED] })).toMatchObject({ reason: 'payment_being_confirmed', step: 'final_account' });
    expect(locate({ requests: [DUE, FINAL_DUE] })).toMatchObject({ reason: 'final_account_due', step: 'final_account' });
    expect(locate({ requests: [DUE, FINAL_CLAIMED] })).toMatchObject({ reason: 'final_account_due', step: 'final_account' });
    expect(locate({ requests: [DUE, FINAL_PAID] })).toMatchObject({ reason: 'final_account_due', step: 'final_account' });
  });

  it('asks for a change-order decision before any payment', () => {
    expect(locate({ requests: [DUE], issuedChangeOrders: 2 }).reason).toBe('decide_change_order');
  });

  it('asks the client to pay before saying an earlier claim is being checked', () => {
    expect(locate({ requests: [CLAIMED, DUE] }).reason).toBe('pay_request');
  });

  it('never shows the client a change order the studio has not issued (F6)', () => {
    expect(locate({ internalChangeOrders: 1 })).toMatchObject({ reason: 'works_in_progress', whoseMove: 'site' });
  });

  it('never asks the client to decide a change order whose link has expired: the studio holds it (F1)', () => {
    const facts = flowFactsOf(model({ expiredChangeOrders: 1 }));
    expect(locateExecutionForClient(facts)).toMatchObject({ reason: 'works_in_progress', whoseMove: 'site' });
    expect(locateExecutionForStudio(facts)).toMatchObject({ whoseMove: 'studio', takenBack: 'change_order_link_expired' });
    expect(locate({ expiredChangeOrders: 1, issuedChangeOrders: 1 }).reason).toBe('decide_change_order');
  });

  it('gives the studio the move on both sides once the signing window has closed (F4)', () => {
    const facts = flowFactsOf(model({ contract: 'issued_closed' }));
    expect(locateExecutionForClient(facts).whoseMove).toBe('studio');
    expect(locateExecutionForStudio(facts).whoseMove).toBe('studio');
  });

  it('reads the uncapped due count, not a request list (F9)', () => {
    const facts = flowFactsOf(model());
    const contract = { ...(facts.stage.contract as ExecutionContractFacts), unpaidRequestCount: 75 };
    const at = locateExecutionForClient({ ...facts, stage: { ...facts.stage, contract }, unclaimedDueRequestCount: 75 });
    expect(at.reason).toBe('pay_request');
  });
});
