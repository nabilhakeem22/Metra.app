import { describe, expect, it } from 'vitest';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { SPINE_STAGES, spinePosition, spineStageKeyOf } from '@/lib/engagements/stage-spine';
import { DESIGN_STATES, type DesignState } from '@/lib/engagements/states';
import { buildPhaseView } from '../build-view';
import { DESIGN_PHASE } from '../phases/design';
import { locateDesignForStudio } from './design-studio';

const STATUSES: [DeliveryStatus, 'studio' | 'client' | null][] = [
  [{ kind: 'yourMove' }, 'studio'],
  [{ kind: 'confirmPayment' }, 'studio'],
  [{ kind: 'waitingClient', days: 2 }, 'client'],
  [{ kind: 'stalled', days: 9 }, 'client'],
  [{ kind: 'delivered' }, null],
  [{ kind: 'abandoned' }, null],
];

describe('locateDesignForStudio', () => {
  it('puts every design state, under every status, on exactly one step with one whose-move', () => {
    for (const state of DESIGN_STATES) {
      for (const [status, actor] of STATUSES) {
        const at = locateDesignForStudio(state, status);
        const position = spinePosition(state);
        if (position.closed) {
          expect(at, state).toEqual({ step: null, whoseMove: null, status: 'closed' });
          continue;
        }
        expect(at.step, state).toBe(spineStageKeyOf(state));
        expect(at.status, state).toBe(position.allComplete ? 'complete' : 'active');
        expect(at.whoseMove, `${state}/${status.kind}`).toBe(position.allComplete ? null : actor);
        expect(at.atGate ?? null, state).toBe(position.atGate);
        buildPhaseView(DESIGN_PHASE, at, 'studio');
      }
    }
  });

  it('marks the gate the delivery waits at, and only that one', () => {
    expect(locateDesignForStudio('concept_review', { kind: 'waitingClient', days: 1 }).atGate).toBe('gateA');
    expect(locateDesignForStudio('final_approval', { kind: 'yourMove' }).atGate).toBe('gateB');
    expect(locateDesignForStudio('negotiation', { kind: 'yourMove' }).atGate).toBeUndefined();
  });

  it('draws the rail the spine drew: the same status per stage, and the gates where the spine has them', () => {
    for (const state of DESIGN_STATES) {
      const position = spinePosition(state);
      const spine = SPINE_STAGES.map((_, index) => {
        if (position.closed) return 'muted';
        if (position.allComplete || index < position.index) return 'done';
        return index === position.index ? 'current' : 'upcoming';
      });
      for (const [status] of STATUSES) {
        const view = buildPhaseView(DESIGN_PHASE, locateDesignForStudio(state, status), 'studio');
        expect(view.steps.map((step) => (view.status === 'closed' ? 'muted' : step.status)), state).toEqual(spine);
        expect(view.atGate, state).toBe(position.atGate);
        expect(view.steps.map((step) => step.gateBefore ?? null), state).toEqual([null, null, null, null, 'gateA', 'gateB', null, null]);
      }
    }
  });

  it('refuses a state or a status it does not know (F8)', () => {
    expect(() => locateDesignForStudio('bogus' as DesignState, { kind: 'yourMove' })).toThrow(/unknown design state/);
    expect(() => locateDesignForStudio('survey', { kind: 'bogus' } as unknown as DeliveryStatus)).toThrow(/unknown delivery status/);
  });

  it('completes the phase at both endings and closes it when abandoned', () => {
    expect(locateDesignForStudio('execution', { kind: 'delivered' }).status).toBe('complete');
    expect(locateDesignForStudio('closed_design_only', { kind: 'delivered' }).status).toBe('complete');
    expect(locateDesignForStudio('abandoned', { kind: 'abandoned' }).status).toBe('closed');
  });
});
