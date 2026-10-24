import { describe, expect, it } from 'vitest';
import { buildPhaseView } from '../build-view';
import { EXECUTION_PHASE } from '../phases/execution';
import {
  CLIENT_EXECUTION_REASONS,
  locateExecutionForClient,
  type ClientExecutionFacts,
  type ClientExecutionReason,
  type ClientPaymentRequestFacts,
} from './execution-client';

const request = (fields: Partial<ClientPaymentRequestFacts> = {}): ClientPaymentRequestFacts => ({
  target: { kind: 'milestone' },
  outstanding: '0.0000',
  void: false,
  claimedAt: null,
  ...fields,
});

const DUE = request({ outstanding: '62000.0000' });
const CLAIMED = request({ outstanding: '62000.0000', claimedAt: '2026-11-05T10:00:00.000Z' });
const PAID = request();
const FINAL_DUE = request({ target: { kind: 'final_account' }, outstanding: '4960.0000' });
const FINAL_PAID = request({ target: { kind: 'final_account' } });

function signed(requests: ClientPaymentRequestFacts[], openVariationCount = 0): ClientExecutionFacts {
  return { contract: { status: 'signed', signingOpen: false }, openVariationCount, money: { requests } };
}

/** One fixture per reason: the facts, and the step and whose-move the client must be shown. */
const FIXTURES: Record<ClientExecutionReason, [ClientExecutionFacts, string | null, string | null]> = {
  preparing_contract: [{ contract: null, openVariationCount: 0, money: null }, 'contract', 'studio'],
  sign_contract: [
    { contract: { status: 'issued', signingOpen: true }, openVariationCount: 0, money: null },
    'signature',
    'client',
  ],
  signing_closed: [
    { contract: { status: 'issued', signingOpen: false }, openVariationCount: 0, money: null },
    'signature',
    'studio',
  ],
  decide_change_order: [signed([DUE], 1), 'works', 'client'],
  pay_request: [signed([DUE, PAID]), 'works', 'client'],
  payment_being_confirmed: [signed([CLAIMED, PAID]), 'works', 'studio'],
  works_in_progress: [signed([PAID]), 'works', 'site'],
  final_account_due: [signed([FINAL_DUE, CLAIMED]), 'final_account', 'client'],
  settled: [signed([FINAL_PAID, PAID]), 'settled', null],
  terminated: [
    { contract: { status: 'terminated', signingOpen: false }, openVariationCount: 1, money: { requests: [DUE] } },
    null,
    null,
  ],
};

describe('locateExecutionForClient', () => {
  it('reaches every reason from a fixture, each on one step with one whose-move', () => {
    for (const reason of CLIENT_EXECUTION_REASONS) {
      const [facts, step, whoseMove] = FIXTURES[reason];
      const at = locateExecutionForClient(facts);
      expect(at.reason, reason).toBe(reason);
      expect(at.step, reason).toBe(step);
      expect(at.whoseMove, reason).toBe(whoseMove);
      const view = buildPhaseView(EXECUTION_PHASE, at, 'client');
      expect(view.currentStep, reason).toBe(at.status === 'active' ? step : null);
    }
  });

  it('completes the phase when settled and closes it when terminated', () => {
    expect(locateExecutionForClient(FIXTURES.settled[0]).status).toBe('complete');
    expect(locateExecutionForClient(FIXTURES.terminated[0]).status).toBe('closed');
  });

  it('asks for a change-order decision before any payment', () => {
    expect(locateExecutionForClient(signed([FINAL_DUE], 2)).reason).toBe('decide_change_order');
  });

  it('asks the client to pay before saying an earlier claim is being checked', () => {
    expect(locateExecutionForClient(signed([CLAIMED, DUE])).reason).toBe('pay_request');
  });

  it('never counts a void request as due, nor a void final account as settling the job', () => {
    expect(locateExecutionForClient(signed([request({ outstanding: '100.0000', void: true })])).reason).toBe(
      'works_in_progress',
    );
    expect(locateExecutionForClient(signed([request({ target: { kind: 'final_account' }, void: true })])).reason).toBe(
      'works_in_progress',
    );
  });

  it('never calls a job settled while its final account still waits on a claim', () => {
    const claimedFinal = request({ target: { kind: 'final_account' }, outstanding: '4960.0000', claimedAt: '2026-11-05T10:00:00.000Z' });
    expect(locateExecutionForClient(signed([claimedFinal])).reason).toBe('payment_being_confirmed');
  });

  it('shows works in progress on a signed contract with no money read yet', () => {
    expect(
      locateExecutionForClient({ contract: { status: 'signed', signingOpen: false }, openVariationCount: 0, money: null })
        .reason,
    ).toBe('works_in_progress');
  });
});
