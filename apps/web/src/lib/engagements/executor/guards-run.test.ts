import type { DesignEngagement } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/result';
import type { GuardFacts } from '../guards';
import type { TransitionDef } from '../transitions';
import { validateGuards } from './guards-run';

// No database: the guards are pure, so running them is pure. `scopeInputsPresent`
// reads titleAr/titleEn/clientId/projectId only, so a partial row cast to the
// full type is a faithful fixture (the same shape guards.test.ts uses).
function facts(over: Partial<DesignEngagement>): GuardFacts {
  return {
    engagement: {
      titleAr: 'عنوان',
      titleEn: 'Title',
      clientId: 'c1',
      projectId: 'p1',
      ...over,
    } as DesignEngagement,
    milestones: [],
    payments: [],
    artifacts: [],
    changeOrders: [],
    events: [],
  };
}

/** The ActionCode a refusing run answered with. */
function codeOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as ActionError).code;
  }
  return undefined;
}

const edge = (guards: TransitionDef['guards']): TransitionDef => ({
  from: 'created',
  to: 'design_proposal',
  guards,
  sideEffect: null,
  capability: 'engagements_design',
});

describe('validateGuards', () => {
  it('returns silently when every guard passes', () => {
    expect(() =>
      validateGuards(edge(['scopeInputsPresent']), facts({})),
    ).not.toThrow();
  });

  it('returns silently for a guard-less edge', () => {
    expect(() => validateGuards(edge([]), facts({}))).not.toThrow();
  });

  it('fails with the code of the refusing guard', () => {
    const run = () =>
      validateGuards(edge(['scopeInputsPresent']), facts({ clientId: '' }));
    expect(run).toThrow(ActionError);
    expect(codeOf(run)).toBe('guard_scope_inputs_missing');
  });

  it('reports the FIRST refusal and does not reach the guards behind it', () => {
    // depositCleared would answer `design_fee_required` on these facts; the
    // edge lists scopeInputsPresent first, so that is the studio's answer.
    const run = () =>
      validateGuards(
        edge(['scopeInputsPresent', 'depositCleared']),
        facts({ clientId: '' }),
      );
    expect(codeOf(run)).toBe('guard_scope_inputs_missing');
  });
});
