import { describe, expect, it } from 'vitest';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
import { executionModels, flowFactsOf, model } from '@/test/execution-flow-model';
import {
  deliveryStatusTone,
  executionDeliveryStatus,
  resolveDeliveryStatus,
  type DeliveryStatus,
} from './delivery-status';
import { DESIGN_STATES, type DesignState } from './states';
import type { WhoseMove } from './whose-move';

const MOVES: WhoseMove[] = ['studio', 'client', 'confirmPayment', 'closed'];
const DAYS = [0, 6, 7];
const ENDED: DesignState[] = ['execution', 'closed_design_only'];

function expected(state: DesignState, whoseMove: WhoseMove, days: number): DeliveryStatus {
  if (state === 'abandoned') return { kind: 'abandoned' };
  if (ENDED.includes(state) || whoseMove === 'closed') return { kind: 'delivered' };
  if (whoseMove === 'confirmPayment') return { kind: 'confirmPayment' };
  if (whoseMove === 'studio') return { kind: 'yourMove' };
  return days >= 7 ? { kind: 'stalled', days } : { kind: 'waitingClient', days };
}

describe('resolveDeliveryStatus over every state x whose move x days', () => {
  for (const state of DESIGN_STATES) {
    for (const whoseMove of MOVES) {
      for (const days of DAYS) {
        it(`${state} / ${whoseMove} / ${days}d`, () => {
          expect(resolveDeliveryStatus({ state, whoseMove, daysSinceChange: days })).toEqual(
            expected(state, whoseMove, days),
          );
        });
      }
    }
  }
});

describe('the rules the product reads', () => {
  it('the client holding it for 7 days is stalled, for 6 is waiting', () => {
    const at = (days: number) =>
      resolveDeliveryStatus({ state: 'concept_review', whoseMove: 'client', daysSinceChange: days });
    expect(at(6)).toEqual({ kind: 'waitingClient', days: 6 });
    expect(at(7)).toEqual({ kind: 'stalled', days: 7 });
  });

  it('the studio holding it for 30 days is still its move, never stalled', () => {
    expect(
      resolveDeliveryStatus({ state: 'layout', whoseMove: 'studio', daysSinceChange: 30 }),
    ).toEqual({ kind: 'yourMove' });
  });

  it('both endings are delivered and done; abandoned is neutral', () => {
    for (const state of ENDED) {
      const status = resolveDeliveryStatus({ state, whoseMove: 'closed', daysSinceChange: 40 });
      expect(status).toEqual({ kind: 'delivered' });
      expect(deliveryStatusTone(status)).toBe('done');
    }
    expect(
      deliveryStatusTone(
        resolveDeliveryStatus({ state: 'abandoned', whoseMove: 'closed', daysSinceChange: 0 }),
      ),
    ).toBe('neutral');
  });

  it('maps each kind onto its tone', () => {
    expect(deliveryStatusTone({ kind: 'yourMove' })).toBe('yourMove');
    expect(deliveryStatusTone({ kind: 'confirmPayment' })).toBe('yourMove');
    expect(deliveryStatusTone({ kind: 'waitingClient', days: 1 })).toBe('waiting');
    expect(deliveryStatusTone({ kind: 'stalled', days: 9 })).toBe('stalled');
  });
});

describe('executionDeliveryStatus: at execution the header follows whose move it is', () => {
  it('every reachable fact set: the studio move is yours, the client move waits unaged, no move is delivered', () => {
    for (const m of executionModels(1)) {
      const location = locateExecutionForStudio(flowFactsOf(m));
      const status = executionDeliveryStatus(location);
      if (location.status !== 'active' || location.whoseMove === null) expect(status, JSON.stringify(m)).toEqual({ kind: 'delivered' });
      else if (location.whoseMove === 'client') expect(status, JSON.stringify(m)).toEqual({ kind: 'waitingClient', days: null });
      else expect(status, JSON.stringify(m)).toEqual({ kind: 'yourMove' });
    }
  });

  it('the readings the cockpit shows: an open signature waits on the client, a closed one and a draft are yours, settled is delivered', () => {
    const statusOf = (overrides: Parameters<typeof model>[0]) => executionDeliveryStatus(locateExecutionForStudio(flowFactsOf(model(overrides))));
    expect(statusOf({ contract: 'issued_open' })).toEqual({ kind: 'waitingClient', days: null });
    expect(statusOf({ contract: 'issued_closed' })).toEqual({ kind: 'yourMove' });
    expect(statusOf({ contract: 'draft' })).toEqual({ kind: 'yourMove' });
    expect(statusOf({ internalChangeOrders: 1 })).toEqual({ kind: 'yourMove' });
    expect(statusOf({ issuedChangeOrders: 1 })).toEqual({ kind: 'waitingClient', days: null });
    expect(statusOf({})).toEqual({ kind: 'delivered' });
    expect(statusOf({ contract: 'terminated' })).toEqual({ kind: 'delivered' });
  });

  it("a move the site team holds is the studio's own", () => {
    expect(executionDeliveryStatus({ step: 'works', whoseMove: 'site', status: 'active' })).toEqual({ kind: 'yourMove' });
  });
});
