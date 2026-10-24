import { describe, expect, it } from 'vitest';
import type { MilestoneKind } from '@metra/db';
import { resolveDeliveryStatus } from '@/lib/engagements/delivery-status';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from '@/lib/engagements/guards/trigger-money-gate';
import { JOURNEY_MILESTONES, stateMilestone } from '@/lib/engagements/journey-map';
import { deriveHero, type HeroKind } from '@/lib/engagements/portal-hero';
import { PORTAL_STAGE_KEY } from '@/lib/engagements/portal-stage';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { DESIGN_STATES, type DesignState } from '@/lib/engagements/states';
import { TRANSITIONS, type Trigger } from '@/lib/engagements/transitions';
import { resolveWhoseMove } from '@/lib/engagements/whose-move';
import { buildPhaseView } from '../build-view';
import { DESIGN_PHASE } from '../phases/design';
import { locateDesignForClient, type ClientDesignFacts } from './design-client';
import { locateDesignForStudio } from './design-studio';

const HERO_KINDS: HeroKind[] = ['action', 'inProgress', 'delivered', 'closed'];
type FeeState = 'due' | 'paid' | 'claimed' | 'absent';
const FEE_STATES: FeeState[] = ['due', 'paid', 'claimed', 'absent'];

/** The delivery page's facts for a state, with one design fee instalment in `fee` state. */
function deliveryAt(state: DesignState, heroKind: HeroKind, kind: MilestoneKind = 'deposit', fee: FeeState = 'absent'): ClientDesignFacts {
  const paymentSchedule: PublicDelivery['paymentSchedule'] =
    fee === 'absent'
      ? []
      : [{ milestone_kind: kind, basis: 'amount', amount_due: '1000.0000', amount_cleared: fee === 'paid' ? '1000.0000' : '0.0000', status: fee === 'paid' ? 'paid' : 'due' }];
  const claimable = fee === 'due' || fee === 'claimed';
  return {
    milestone: stateMilestone(state),
    stageKey: PORTAL_STAGE_KEY[state],
    hero: { kind: heroKind, showRomAck: false },
    paymentSchedule,
    paymentClaim: {
      claimableMilestones: claimable
        ? [{ milestoneKind: kind, amountRemaining: '1000.0000', hasPendingClaim: fee === 'claimed', claimedAt: null }]
        : [],
    },
  };
}

/** Every trigger that waits on a design fee instalment, with the state it leaves and the instalment. */
const MONEY_GATES = (Object.keys(TRANSITIONS) as Trigger[]).flatMap((trigger) => {
  const guard = moneyGuardOf(trigger);
  const kind = guard && MONEY_GUARD_MILESTONE[guard];
  return guard && kind ? [[trigger, [TRANSITIONS[trigger].from].flat(), guard, kind] as const] : [];
});

describe('locateDesignForClient', () => {
  it('puts every design state, with every hero and fee, on exactly one milestone with one whose-move', () => {
    for (const state of DESIGN_STATES) {
      const milestone = stateMilestone(state);
      for (const heroKind of HERO_KINDS) {
        for (const fee of FEE_STATES) {
          const at = locateDesignForClient(deliveryAt(state, heroKind, 'gate_a', fee));
          const label = `${state}/${heroKind}/${fee}`;
          if (milestone.closed) expect(at, label).toEqual({ step: null, whoseMove: null, status: 'closed' });
          else if (milestone.allComplete) expect(at, label).toEqual({ step: 'handover', whoseMove: null, status: 'complete' });
          else {
            expect(at.step, label).toBe(JOURNEY_MILESTONES[milestone.index]);
            expect(at.whoseMove, label).not.toBeNull();
          }
          const view = buildPhaseView(DESIGN_PHASE, at, 'client');
          expect(view.steps.map((step) => step.key), label).toEqual([...JOURNEY_MILESTONES]);
          expect(view.steps.filter((step) => step.status === 'current').length, label).toBe(at.status === 'active' ? 1 : 0);
          expect(view.atGate, label).toBeNull();
        }
      }
    }
  });

  it('gives the client the move exactly when the page hero asks them to act, away from a fee gate', () => {
    const hero = deriveHero(['approve_concept'], 'concept_review');
    expect(locateDesignForClient(deliveryAt('concept_review', hero.kind))).toEqual({ step: 'concept', whoseMove: 'client', status: 'active' });
    expect(locateDesignForClient(deliveryAt('design_3d', deriveHero([], 'design_3d').kind)).whoseMove).toBe('studio');
  });

  it('knows the four fee gates the machine waits at', () => {
    const gates = MONEY_GATES.flatMap(([, states, , kind]) => states.map((state) => `${state}:${kind}`));
    expect(gates.sort()).toEqual(['concept_review:gate_a', 'design_proposal:deposit', 'execution_decision:balance', 'execution_decision:balance', 'final_approval:gate_b']);
  });

  it('gives the client the move while the studio waits on their fee at a gate, and the studio once they have claimed it (F5)', () => {
    for (const [trigger, states, guard, kind] of MONEY_GATES) {
      for (const state of states) {
        const preview = { primaryTrigger: trigger, endingChoices: [], items: [{ guard, ok: false, code: null, amountDue: '1000.0000' }], awaitingClientReview: false };
        const label = `${state}/${kind}`;
        const waiting = resolveDeliveryStatus({ state, whoseMove: resolveWhoseMove({ state, preview, pendingClaimCount: 0 }), daysSinceChange: 1 });
        expect(locateDesignForStudio(state, waiting).whoseMove, label).toBe('client');
        expect(locateDesignForClient(deliveryAt(state, 'inProgress', kind, 'due')).whoseMove, label).toBe('client');

        const confirming = resolveDeliveryStatus({ state, whoseMove: resolveWhoseMove({ state, preview, pendingClaimCount: 1 }), daysSinceChange: 1 });
        expect(locateDesignForStudio(state, confirming).whoseMove, label).toBe('studio');
        expect(locateDesignForClient(deliveryAt(state, 'inProgress', kind, 'claimed')).whoseMove, label).toBe('studio');

        expect(locateDesignForClient(deliveryAt(state, 'inProgress', kind, 'paid')).whoseMove, label).toBe('studio');
        expect(locateDesignForClient(deliveryAt(state, 'inProgress', kind, 'absent')).whoseMove, label).toBe('studio');
      }
    }
  });

  it('does not ask for a fee before its gate', () => {
    expect(locateDesignForClient(deliveryAt('layout', 'inProgress', 'gate_a', 'due')).whoseMove).toBe('studio');
    expect(locateDesignForClient(deliveryAt('design_3d', 'inProgress', 'gate_b', 'due')).whoseMove).toBe('studio');
  });

  it('refuses a milestone index past the journey (F8)', () => {
    const facts = { ...deliveryAt('survey', 'inProgress'), milestone: { index: 6, allComplete: false, closed: false } };
    expect(() => locateDesignForClient(facts)).toThrow(/not a journey milestone/);
  });
});
