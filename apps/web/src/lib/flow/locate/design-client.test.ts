import { describe, expect, it } from 'vitest';
import { JOURNEY_MILESTONES, stateMilestone } from '@/lib/engagements/journey-map';
import { deriveHero, type HeroKind } from '@/lib/engagements/portal-hero';
import { DESIGN_STATES } from '@/lib/engagements/states';
import { buildPhaseView } from '../build-view';
import { DESIGN_PHASE } from '../phases/design';
import { locateDesignForClient } from './design-client';

const HERO_KINDS: HeroKind[] = ['action', 'inProgress', 'delivered', 'closed'];

describe('locateDesignForClient', () => {
  it('puts every design state, with every hero, on exactly one milestone with one whose-move', () => {
    for (const state of DESIGN_STATES) {
      const milestone = stateMilestone(state);
      for (const heroKind of HERO_KINDS) {
        const at = locateDesignForClient(milestone, heroKind);
        if (milestone.closed) {
          expect(at, state).toEqual({ step: null, whoseMove: null, status: 'closed' });
        } else if (milestone.allComplete) {
          expect(at, state).toEqual({ step: 'handover', whoseMove: null, status: 'complete' });
        } else {
          expect(at.step, state).toBe(JOURNEY_MILESTONES[milestone.index]);
          expect(at.whoseMove, `${state}/${heroKind}`).toBe(heroKind === 'action' ? 'client' : 'studio');
        }
        // The client view of the design phase is the journey, so its steps take this location.
        const view = buildPhaseView(DESIGN_PHASE, at, 'client');
        expect(view.atGate).toBeNull();
      }
    }
  });

  it('gives the client the move exactly when the page hero asks them to act', () => {
    const concept = stateMilestone('concept_review');
    const hero = deriveHero(['approve_concept'], 'concept_review');
    expect(locateDesignForClient(concept, hero.kind)).toEqual({ step: 'concept', whoseMove: 'client', status: 'active' });
    const waiting = deriveHero([], 'design_3d');
    expect(locateDesignForClient(stateMilestone('design_3d'), waiting.kind).whoseMove).toBe('studio');
  });
});
