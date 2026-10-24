import { describe, expect, it } from 'vitest';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { spinePosition, spineStageKeyOf } from '@/lib/engagements/stage-spine';
import { DESIGN_STATES } from '@/lib/engagements/states';
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

  it('completes the phase at both endings and closes it when abandoned', () => {
    expect(locateDesignForStudio('execution', { kind: 'delivered' }).status).toBe('complete');
    expect(locateDesignForStudio('closed_design_only', { kind: 'delivered' }).status).toBe('complete');
    expect(locateDesignForStudio('abandoned', { kind: 'abandoned' }).status).toBe('closed');
  });
});
