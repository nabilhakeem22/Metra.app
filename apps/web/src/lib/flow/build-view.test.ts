import { describe, expect, it } from 'vitest';
import { buildPhaseView } from './build-view';
import type { PhaseDefinition, PhaseStatus, StepLocation } from './types';

const PHASE: PhaseDefinition = {
  key: 'design',
  steps: [
    { key: 'a', defaultActor: 'studio', clientStep: 'first' },
    { key: 'b', defaultActor: 'client', clientStep: 'first' },
    { key: 'c', defaultActor: 'studio', gateBefore: 'gateA', clientStep: 'second' },
    { key: 'd', defaultActor: 'site' },
  ],
};

describe('buildPhaseView', () => {
  it('marks the steps before, at and after the current one for the studio, gates kept', () => {
    const view = buildPhaseView(PHASE, { step: 'c', whoseMove: 'client', status: 'active', atGate: 'gateA' }, 'studio');
    expect(view.steps).toEqual([
      { key: 'a', status: 'done', actor: 'studio' },
      { key: 'b', status: 'done', actor: 'client' },
      { key: 'c', status: 'current', actor: 'client', gateBefore: 'gateA' },
      { key: 'd', status: 'upcoming', actor: 'site' },
    ]);
    expect(view).toMatchObject({ key: 'design', status: 'active', currentStep: 'c', whoseMove: 'client', atGate: 'gateA' });
  });

  it('groups the steps for the client and drops every gate', () => {
    const view = buildPhaseView(PHASE, { step: 'second', whoseMove: 'studio', status: 'active', atGate: 'gateA' }, 'client');
    expect(view.steps).toEqual([
      { key: 'first', status: 'done', actor: 'studio' },
      { key: 'second', status: 'current', actor: 'studio' },
      { key: 'd', status: 'upcoming', actor: 'site' },
    ]);
    expect(view.atGate).toBeNull();
  });

  it('keeps the default actor on the current step when nobody holds the move', () => {
    const view = buildPhaseView(PHASE, { step: 'd', whoseMove: null, status: 'active' }, 'studio');
    expect(view.steps[3]).toEqual({ key: 'd', status: 'current', actor: 'site' });
  });

  it('marks every step done once complete, and none current', () => {
    const view = buildPhaseView(PHASE, { step: 'd', whoseMove: null, status: 'complete' }, 'studio');
    expect(view.steps.every((step) => step.status === 'done')).toBe(true);
    expect(view.currentStep).toBeNull();
  });

  it('marks nothing done or current once closed', () => {
    const view = buildPhaseView(PHASE, { step: null, whoseMove: null, status: 'closed' }, 'studio');
    expect(view.steps.every((step) => step.status === 'upcoming')).toBe(true);
    expect(view.currentStep).toBeNull();
  });

  it('refuses a location the phase cannot draw (F8)', () => {
    const refused: [string, StepLocation, RegExp][] = [
      ['complete short of the last step', { step: 'c', whoseMove: null, status: 'complete' }, /complete design phase/],
      ['complete on a step it lacks', { step: 'bogus', whoseMove: null, status: 'complete' }, /complete design phase/],
      ['complete with a move', { step: 'd', whoseMove: 'studio', status: 'complete' }, /complete design phase/],
      ['closed on a step', { step: 'a', whoseMove: null, status: 'closed' }, /closed design phase/],
      ['closed with a move', { step: null, whoseMove: 'client', status: 'closed' }, /closed design phase/],
      ['an unknown status', { step: 'a', whoseMove: null, status: 'paused' as PhaseStatus }, /unknown phase status/],
      ['active on no step', { step: null, whoseMove: 'studio', status: 'active' }, /not a step of the design phase/],
    ];
    for (const [label, at, message] of refused) expect(() => buildPhaseView(PHASE, at, 'studio'), label).toThrow(message);
  });

  it('refuses a location on a step the phase does not have', () => {
    expect(() => buildPhaseView(PHASE, { step: 'first', whoseMove: null, status: 'active' }, 'studio')).toThrow(
      /not a step of the design phase/,
    );
  });
});
