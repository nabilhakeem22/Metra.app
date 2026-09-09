import { describe, expect, it } from 'vitest';
import { DESIGN_STATES, type DesignState } from './states';
import { SPINE_NODES, SPINE_STAGES, spinePosition } from './stage-spine';
import { TRANSITIONS } from './transitions';
import type { GuardKey } from './guards';

/** The money guard that each spine gate is, in the machine's own vocabulary. */
const GATE_GUARD = {
  gateA: 'gateAInstallmentCleared',
  gateB: 'gateBInstallmentCleared',
} as const satisfies Record<string, GuardKey>;

/**
 * Can a transition guarded by `guard` still be reached from `state`? Walks the
 * registry forward, cycles included (`rejectDesign` and the revision self-loops
 * are real edges), so "reachable" means what it says rather than "on the happy
 * path".
 */
function guardStillAhead(state: DesignState, guard: GuardKey): boolean {
  const seen = new Set<DesignState>();
  const queue: DesignState[] = [state];
  while (queue.length > 0) {
    const at = queue.shift() as DesignState;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const t of Object.values(TRANSITIONS)) {
      const from = Array.isArray(t.from) ? t.from : [t.from];
      if (!from.includes(at)) continue;
      if (t.guards.includes(guard)) return true;
      queue.push(t.to);
    }
  }
  return false;
}

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
    // NOT negotiation: reaching it required clearing the Gate-A instalment. This
    // line asserted 'gateA' when the file was written, which is how a green suite
    // shipped the bug — see the reachability test below.
    expect(spinePosition('negotiation').atGate).toBeNull();
    expect(spinePosition('final_approval').atGate).toBe('gateB');
    // The as-built detour hangs off final_approval, so it waits at the same gate.
    expect(spinePosition('change_triage').atGate).toBe('gateB');
  });

  it('never marks a gate the engagement has already cleared', () => {
    // THE TEST THAT SHOULD HAVE EXISTED FIRST. Every other assertion in this file
    // checks the spine map against ITSELF, which validates spelling and not truth
    // — and a whole suite of them passed while `negotiation` was marked at Gate A.
    // It cannot be: the only edge into `negotiation` from before the gate is
    // `selectConcept`, whose sole guard IS `gateAInstallmentCleared`, and payments
    // are append-only, so being in that state proves the money cleared.
    //
    // The rule is REACHABILITY, not the immediate out-edge: `change_triage` is
    // legitimately at Gate B even though its own forward trigger carries no money
    // guard, because it rejoins `final_approval` and `approveDesign` is still
    // ahead of it. Only a gate that is genuinely still in front may be marked.
    for (const state of DESIGN_STATES) {
      const at = spinePosition(state as DesignState);
      if (at.atGate === null) continue;
      expect(
        guardStillAhead(state as DesignState, GATE_GUARD[at.atGate]),
        `${state} is marked at ${at.atGate}, but ${GATE_GUARD[at.atGate]} is not reachable from it`,
      ).toBe(true);
    }
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
