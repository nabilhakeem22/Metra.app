import { describe, expect, it } from 'vitest';
import { projectDeliveryOffer } from './project-delivery-offer';

// The project panel's offer (H4 follow-up F3): a light delivery is the client
// page of an execution contract, so the panel never calls it a design
// delivery, and the first design delivery after it is a start, not an
// extension.

describe('projectDeliveryOffer', () => {
  it('offers the first delivery on a project with none', () => {
    expect(projectDeliveryOffer(null, 0)).toEqual({ heading: 'heading', create: 'start', atLimit: false });
  });

  it('offers nothing while a design delivery is in flight', () => {
    expect(projectDeliveryOffer({ state: 'concept_review', entryPhase: 'design' }, 1)).toEqual({
      heading: 'heading',
      create: null,
      atLimit: false,
    });
  });

  it('offers the ONE extension after a counted delivery, and nothing at the cap', () => {
    expect(projectDeliveryOffer({ state: 'closed_design_only', entryPhase: 'design' }, 1)).toEqual({
      heading: 'heading',
      create: 'extend',
      atLimit: false,
    });
    expect(projectDeliveryOffer({ state: 'execution', entryPhase: 'design' }, 2)).toEqual({ heading: 'heading', create: null, atLimit: true });
  });

  it('names a light delivery as the client page, and offers a START when it is the only delivery', () => {
    expect(projectDeliveryOffer({ state: 'execution', entryPhase: 'execution' }, 0)).toEqual({
      heading: 'lightHeading',
      create: 'start',
      atLimit: false,
    });
  });

  it('offers the extension beside a light delivery once one design delivery is counted', () => {
    expect(projectDeliveryOffer({ state: 'execution', entryPhase: 'execution' }, 1)).toEqual({
      heading: 'lightHeading',
      create: 'extend',
      atLimit: false,
    });
  });
});
