import { describe, expect, it } from 'vitest';
import { projectDeliveryOffer } from './project-delivery-offer';
import { DESIGN_STATES, isTerminal } from './states';

// The project panel's offer: one delivery per client per project (owner ruling,
// Nov 2 2026), and a light delivery is the client page of an execution contract,
// never called a design delivery.

const CLIENT = 'client-a';

describe('projectDeliveryOffer', () => {
  it('offers the first delivery on a project with none', () => {
    expect(projectDeliveryOffer(null, CLIENT)).toEqual({ heading: 'heading', create: 'start' });
  });

  it('offers a start after an abandoned delivery, of this client or another', () => {
    expect(projectDeliveryOffer({ state: 'abandoned', entryPhase: 'design', clientId: CLIENT }, CLIENT).create).toBe('start');
    expect(projectDeliveryOffer({ state: 'abandoned', entryPhase: 'design', clientId: 'client-b' }, CLIENT).create).toBe('start');
  });

  it.each(DESIGN_STATES.filter((state) => state !== 'abandoned'))('%s of the same client offers nothing', (state) => {
    expect(projectDeliveryOffer({ state, entryPhase: 'design', clientId: CLIENT }, CLIENT).create).toBeNull();
  });

  it.each(DESIGN_STATES)('%s of another client offers a start only once it is terminal', (state) => {
    expect(projectDeliveryOffer({ state, entryPhase: 'design', clientId: 'client-b' }, CLIENT).create).toBe(
      isTerminal(state) ? 'start' : null,
    );
  });

  it('names a light delivery as the client page, and offers nothing beside it', () => {
    expect(projectDeliveryOffer({ state: 'execution', entryPhase: 'execution', clientId: CLIENT }, CLIENT)).toEqual({
      heading: 'lightHeading',
      create: null,
    });
  });
});
