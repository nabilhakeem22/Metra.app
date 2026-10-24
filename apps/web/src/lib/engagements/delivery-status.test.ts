import { describe, expect, it } from 'vitest';
import { EXECUTION_NEXT_ACTION_KINDS, EXECUTION_STAGES } from '@/lib/execution/stage';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
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
  it('every stage with every next action: the studio move is yours, the client move waits unaged, no move is delivered', () => {
    for (const stage of EXECUTION_STAGES) {
      for (const kind of [...EXECUTION_NEXT_ACTION_KINDS, null]) {
        const location = locateExecutionForStudio({ stage, next: kind === null ? null : { kind } });
        const status = executionDeliveryStatus(location);
        if (location.status !== 'active' || location.whoseMove === null) expect(status, `${stage}/${kind}`).toEqual({ kind: 'delivered' });
        else if (location.whoseMove === 'client') expect(status, `${stage}/${kind}`).toEqual({ kind: 'waitingClient', days: null });
        else expect(status, `${stage}/${kind}`).toEqual({ kind: 'yourMove' });
      }
    }
  });

  it('the readings the cockpit shows: signature waits on the client, a draft is yours, settled is delivered', () => {
    expect(executionDeliveryStatus(locateExecutionForStudio({ stage: 'awaiting_signature', next: { kind: 'record_signed_offline' } }))).toEqual({
      kind: 'waitingClient',
      days: null,
    });
    expect(executionDeliveryStatus(locateExecutionForStudio({ stage: 'draft', next: { kind: 'send_contract' } }))).toEqual({ kind: 'yourMove' });
    expect(executionDeliveryStatus(locateExecutionForStudio({ stage: 'settled', next: null }))).toEqual({ kind: 'delivered' });
    expect(executionDeliveryStatus(locateExecutionForStudio({ stage: 'terminated', next: null }))).toEqual({ kind: 'delivered' });
  });

  it("a move the site team holds is the studio's own", () => {
    expect(executionDeliveryStatus({ step: 'works', whoseMove: 'site', status: 'active' })).toEqual({ kind: 'yourMove' });
  });
});
