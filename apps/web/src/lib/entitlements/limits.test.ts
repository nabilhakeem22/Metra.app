import { describe, expect, it } from 'vitest';
import { PROJECT_LIMIT_KEY, withinLimit } from './limits';

const ent = (limits: Record<string, number>) => ({
  enabledFlows: [],
  limits,
  features: {},
});

// The projects spec asks for a per-plan cap. The dangerous half of that feature is
// not the cap itself but what happens when NO cap is configured — which is the state
// every one of the 302 production workspaces is in today.

describe('withinLimit', () => {
  it('treats an UNSET limit as unlimited', () => {
    // Load-bearing. If an absent key read as 0, shipping this would have locked
    // every existing workspace out of creating a project.
    expect(withinLimit(ent({}), PROJECT_LIMIT_KEY, 0)).toBe(true);
    expect(withinLimit(ent({}), PROJECT_LIMIT_KEY, 5_000)).toBe(true);
    expect(withinLimit(ent({ other: 1 }), PROJECT_LIMIT_KEY, 5_000)).toBe(true);
  });

  it('enforces a configured limit at the boundary', () => {
    const e = ent({ [PROJECT_LIMIT_KEY]: 3 });
    expect(withinLimit(e, PROJECT_LIMIT_KEY, 0)).toBe(true);
    expect(withinLimit(e, PROJECT_LIMIT_KEY, 2)).toBe(true);
    // The third project fills the third seat; a fourth is refused.
    expect(withinLimit(e, PROJECT_LIMIT_KEY, 3)).toBe(false);
    expect(withinLimit(e, PROJECT_LIMIT_KEY, 4)).toBe(false);
  });

  it('honours an explicit ZERO as a real, disabled capability', () => {
    // Distinct from unset: somebody deliberately set it to none.
    expect(withinLimit(ent({ [PROJECT_LIMIT_KEY]: 0 }), PROJECT_LIMIT_KEY, 0)).toBe(
      false,
    );
  });

  it('ignores nonsense configuration rather than trusting it', () => {
    // A negative or non-finite limit can only be bad config. Trusting it would
    // silently block a paying workspace, so it degrades to unlimited instead.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(withinLimit(ent({ [PROJECT_LIMIT_KEY]: bad }), PROJECT_LIMIT_KEY, 99)).toBe(
        true,
      );
    }
    // A non-numeric value coming from untrusted jsonb behaves the same way.
    const junk = ent({ [PROJECT_LIMIT_KEY]: '3' as unknown as number });
    expect(withinLimit(junk, PROJECT_LIMIT_KEY, 99)).toBe(true);
  });
});
