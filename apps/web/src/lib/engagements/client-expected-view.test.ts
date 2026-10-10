import { describe, expect, it } from 'vitest';
import { clientExpectedViewOf, type ClientExpectedViewInput } from './client-expected-view';

const SET = { on: '2026-10-20', state: 'concept_review', setAt: '2026-10-10T08:00:00.000Z' } as const;

function view(overrides: Partial<ClientExpectedViewInput>) {
  return clientExpectedViewOf({
    expected: SET,
    state: 'concept_review',
    transitions: [],
    today: '2026-10-10',
    ...overrides,
  });
}

describe('clientExpectedViewOf', () => {
  it('is none when no date is set', () => {
    expect(view({ expected: null })).toEqual({ kind: 'none' });
  });

  it('shows the date while the stage holds, nothing moved and the day has not passed', () => {
    expect(view({})).toEqual({ kind: 'showing', on: '2026-10-20' });
    expect(view({ today: '2026-10-20' })).toEqual({ kind: 'showing', on: '2026-10-20' });
  });

  it('is stale once the date has passed', () => {
    expect(view({ today: '2026-10-21' })).toEqual({ kind: 'stale', on: '2026-10-20' });
  });

  it('is stale once the delivery is in another stage', () => {
    expect(view({ state: 'negotiation' })).toEqual({ kind: 'stale', on: '2026-10-20' });
  });

  it('is stale after a revision loop that came back to the same stage', () => {
    const transitions = [
      { fromState: 'concept_review', toState: 'negotiation', decidedAt: new Date('2026-10-11T08:00:00Z') },
      { fromState: 'negotiation', toState: 'concept_review', decidedAt: '2026-10-12T08:00:00Z' },
    ] as const;
    expect(view({ transitions })).toEqual({ kind: 'stale', on: '2026-10-20' });
  });

  it('ignores moves before it was set, self-loops and transitions with no state', () => {
    const transitions = [
      { fromState: 'layout', toState: 'concept_review', decidedAt: '2026-10-09T08:00:00Z' },
      { fromState: 'concept_review', toState: 'concept_review', decidedAt: '2026-10-11T08:00:00Z' },
      { fromState: 'concept_review', toState: null, decidedAt: '2026-10-11T09:00:00Z' },
    ] as const;
    expect(view({ transitions })).toEqual({ kind: 'showing', on: '2026-10-20' });
  });
});
