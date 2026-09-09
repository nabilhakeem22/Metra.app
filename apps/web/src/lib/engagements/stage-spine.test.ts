import { describe, expect, it } from 'vitest';
import { DESIGN_STATES, type DesignState } from './states';
import { SPINE_NODES, SPINE_STAGES, spinePosition } from './stage-spine';

describe('the spine itself', () => {
  it('puts each gate between the two stages it separates', () => {
    // Gate A separates the concept from the 3D work; Gate B separates the design
    // from the drawings that build it. Drawn inline is what makes the spine
    // explain the workflow rather than only track it.
    const keys = SPINE_NODES.map((n) => n.key);
    expect(keys).toEqual([
      'proposal',
      'survey',
      'layout',
      'concept',
      'gateA',
      'threeD',
      'gateB',
      'shopDrawings',
      'boq',
      'handover',
    ]);
  });

  it('is not the client journey map', () => {
    // The regression this file exists to prevent. The cockpit used to render the
    // five-milestone CLIENT ribbon, which hides the gates on purpose because a
    // homeowner should never be shown the machine. A studio must see them.
    expect(SPINE_STAGES.length).toBeGreaterThan(5);
    expect(SPINE_NODES.some((n) => n.kind === 'gate')).toBe(true);
  });
});

describe('spinePosition', () => {
  it('places every state on a real segment', () => {
    for (const state of DESIGN_STATES) {
      const at = spinePosition(state as DesignState);
      expect(at.index, state).toBeGreaterThanOrEqual(0);
      expect(at.index, state).toBeLessThan(SPINE_STAGES.length);
    }
  });

  it('advances monotonically along the happy path', () => {
    const path: DesignState[] = [
      'created',
      'design_proposal',
      'survey',
      'layout',
      'concept_review',
      'design_3d',
      'shop_drawings',
      'boq',
      'execution_decision',
    ];
    const indexes = path.map((s) => spinePosition(s).index);
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i], path[i]).toBeGreaterThanOrEqual(indexes[i - 1]);
    }
  });

  it('marks the gate the engagement is actually waiting at', () => {
    expect(spinePosition('concept_review').atGate).toBe('gateA');
    expect(spinePosition('negotiation').atGate).toBe('gateA');
    expect(spinePosition('final_approval').atGate).toBe('gateB');
    // The as-built detour hangs off final_approval, so it waits at the same gate.
    expect(spinePosition('change_triage').atGate).toBe('gateB');
  });

  it('is at no gate while the studio is doing its own work', () => {
    for (const state of ['survey', 'layout', 'design_3d', 'shop_drawings', 'boq'] as const) {
      expect(spinePosition(state).atGate, state).toBeNull();
    }
  });

  it('keeps final_approval on the 3D stage rather than giving it one', () => {
    // final_approval IS Gate B — it is where the engagement waits while the gate's
    // guards are worked through. A segment of its own beside the gate marker would
    // draw the same thing twice.
    expect(spinePosition('final_approval').index).toBe(
      spinePosition('design_3d').index,
    );
  });

  it('mutes an abandoned engagement and completes a delivered one', () => {
    expect(spinePosition('abandoned')).toMatchObject({ closed: true, atGate: null });
    for (const state of ['closed_design_only', 'execution'] as const) {
      expect(spinePosition(state)).toMatchObject({ allComplete: true, atGate: null });
    }
  });
});
