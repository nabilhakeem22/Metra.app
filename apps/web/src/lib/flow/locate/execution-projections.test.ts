import { describe, expect, it } from 'vitest';
import { EXECUTION_NEXT_ACTION_KINDS, executionStage, type ExecutionNextActionKind } from '@/lib/execution/stage';
import { executionModels, flowFactsOf, model } from '@/test/execution-flow-model';
import { buildPhaseView } from '../build-view';
import { EXECUTION_PHASE } from '../phases/execution';
import type { StepLocation } from '../types';
import { CLIENT_EXECUTION_REASONS, locateExecutionForClient, type ClientExecutionReason } from './execution-client';
import type { ExecutionFlowFacts } from './execution-facts';
import { locateExecutionForStudio } from './execution-studio';

// The studio and the client execution views are two projections of ONE fact
// model. Checked over every reachable model with up to three payment requests
// (src/test/execution-flow-model.ts), not over hand-picked cases.

/**
 * The act a studio location asks the STUDIO to do when it holds the move. A
 * paper signature is the contract's signature, and recording a payment is the
 * client's payment arriving, so those two name the client's act. The studio
 * holds a change-order wait only while one is still to be issued.
 */
function studioAct(kind: ExecutionNextActionKind): string {
  if (kind === 'record_signed_offline') return 'sign_contract';
  if (kind === 'record_payment') return 'pay';
  if (kind === 'await_variation_answer') return 'issue_change_order';
  return kind;
}

/** The act a client location asks the CLIENT to do when it holds the move. */
const CLIENT_ACT: Partial<Record<ClientExecutionReason, string>> = {
  sign_contract: 'sign_contract',
  decide_change_order: 'decide_change_order',
  pay_request: 'pay',
  final_account_due: 'pay',
};

/** The view draws one current step while active and none otherwise, and a move is named exactly while active. */
function drawable(at: StepLocation, audience: 'studio' | 'client'): boolean {
  const view = buildPhaseView(EXECUTION_PHASE, at, audience);
  const current = view.steps.filter((step) => step.status === 'current').length;
  return current === (at.status === 'active' ? 1 : 0) && (at.whoseMove === null) === (at.status !== 'active');
}

/** Every rule the two projections must keep at one moment; the names of the ones broken. */
function brokenRules(facts: ExecutionFlowFacts): string[] {
  const studio = locateExecutionForStudio(facts);
  const client = locateExecutionForClient(facts);
  const next = executionStage(facts.stage).next;
  const rules: [string, boolean][] = [
    // The step is the contract stage's, identical on both sides.
    ['same step', client.step === studio.step],
    ['same status', client.status === studio.status],
    ['studio view drawable', drawable(studio, 'studio')],
    ['client view drawable', drawable(client, 'client')],
    // Whoever one side says the job waits on has the move on their own side.
    ['studio waits on a client with a move', studio.whoseMove !== 'client' || client.whoseMove === 'client'],
    ['client waits on a studio with a move', client.whoseMove !== 'studio' || studio.whoseMove === 'studio'],
    ['a client move names an act', client.whoseMove !== 'client' || CLIENT_ACT[client.reason] !== undefined],
    // Both may hold a move at once (F7), but never the same act.
    [
      'never the same act on both sides',
      !(studio.whoseMove === 'studio' && client.whoseMove === 'client' && next) ||
        studioAct(next.kind) !== CLIENT_ACT[client.reason],
    ],
  ];
  return rules.filter(([, kept]) => !kept).map(([rule]) => rule);
}

describe('the studio and client execution projections', () => {
  it('agree on every reachable model: one step, one status, and never the same act claimed twice', () => {
    const reasons = new Set<ClientExecutionReason>();
    const kinds = new Set<ExecutionNextActionKind>();
    const broken: string[] = [];
    let models = 0;
    for (const m of executionModels(3)) {
      models += 1;
      const facts = flowFactsOf(m);
      reasons.add(locateExecutionForClient(facts).reason);
      const next = executionStage(facts.stage).next;
      if (next) kinds.add(next.kind);
      const rules = brokenRules(facts);
      if (rules.length > 0 && broken.length < 5) broken.push(`${rules.join(', ')}: ${JSON.stringify(m)}`);
    }
    expect(broken).toEqual([]);
    expect(models).toBeGreaterThan(100_000);
    expect([...reasons].sort()).toEqual([...CLIENT_EXECUTION_REASONS].sort());
    expect([...kinds].sort()).toEqual([...EXECUTION_NEXT_ACTION_KINDS].sort());
  });

  it('lets both sides hold a different move at once, as ruled (F7)', () => {
    // A claim for the studio to review while another request is due from the client.
    const facts = flowFactsOf(model({ requests: [{ kind: 'milestone', state: 'claimed' }, { kind: 'milestone', state: 'due' }] }));
    expect(locateExecutionForStudio(facts).whoseMove).toBe('studio');
    expect(locateExecutionForClient(facts)).toMatchObject({ reason: 'pay_request', whoseMove: 'client' });
    expect(brokenRules(facts)).toEqual([]);
  });
});
