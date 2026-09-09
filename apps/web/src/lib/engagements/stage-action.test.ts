import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import ar from '@/messages/ar-EG.json';
import type { CommandCardMode } from './command-card';
import { DESIGN_STATES, isTerminal, type DesignState } from './states';
import { resolveStageAction, stageActionKeys } from './stage-action';

const MODES: CommandCardMode[] = ['closed', 'ready', 'blockedStudio', 'blockedClient'];

function lookup(bundle: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, seg) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[seg]
          : undefined,
      bundle,
    );
}

describe('the fallback row', () => {
  // Written first because it is the only row guaranteed to be reachable: Metra is
  // enterable at any stage, so a rescue entry into an unusual state must never
  // render a blank hero. Every state x every blocked mode resolves to SOMETHING.
  it('resolves every state in both blocked modes, with no blank key', () => {
    for (const state of DESIGN_STATES) {
      for (const mode of ['blockedStudio', 'blockedClient'] as const) {
        const action = resolveStageAction(state, mode);
        expect(action, `${state} / ${mode}`).not.toBeNull();
        expect(action?.key, `${state} / ${mode}`).toBeTruthy();
      }
    }
  });
});

describe('resolveStageAction', () => {
  it('leaves ready and closed to their own copy', () => {
    // Those two modes do not vary by state — `ready` interpolates the phase name
    // and `closed` names nothing — so a per-state table there would be sixteen
    // identical rows. Null means "the existing headline stands".
    for (const state of DESIGN_STATES) {
      expect(resolveStageAction(state, 'ready')).toBeNull();
      expect(resolveStageAction(state, 'closed')).toBeNull();
    }
  });

  it('makes the mode the actor — a blocked-client row is never studio voice', () => {
    for (const state of DESIGN_STATES) {
      expect(resolveStageAction(state, 'blockedStudio')?.actor).toBe('studio');
      expect(resolveStageAction(state, 'blockedClient')?.actor).toBe('client');
    }
  });

  it('names the literal act at the stages where the studio holds the work', () => {
    // Not an inventory of the table — these are the four the cockpit spends most
    // of its life in, and a regression that silently drops one back to the
    // fallback would read as "nothing is waiting on you" while a file is missing.
    for (const state of ['survey', 'layout', 'design_3d', 'shop_drawings'] as const) {
      expect(resolveStageAction(state, 'blockedStudio')?.key).toBe(state);
    }
  });

  it('names what the client holds, rather than only that they hold it', () => {
    for (const state of ['concept_review', 'execution_decision'] as const) {
      expect(resolveStageAction(state, 'blockedClient')?.key).toBe(state);
    }
  });

  it('falls back for a state gated only by client money, in studio voice', () => {
    // concept_review's sole forward guard is the Gate-A instalment. A studio
    // blocker there is off the happy path, so it gets the fallback rather than
    // invented copy about work that does not exist.
    expect(resolveStageAction('concept_review', 'blockedStudio')?.key).toBe('fallback');
  });

  it('never blanks a terminal state', () => {
    // A terminal engagement resolves to `closed` in practice, but the registry is
    // called before that is guaranteed on a rescue entry.
    for (const state of DESIGN_STATES.filter((s) => isTerminal(s as DesignState))) {
      for (const mode of MODES) {
        expect(() => resolveStageAction(state, mode)).not.toThrow();
      }
    }
  });
});

describe('copy parity', () => {
  // The states gallery is how a human reviews these rows; this is how the BUILD
  // reviews them. A missing Arabic string must fail here rather than render a raw
  // message key on a studio owner's screen in Cairo.
  it.each(stageActionKeys())('%s has a headline and a sub in both locales', (key) => {
    for (const [name, bundle] of [
      ['en', en],
      ['ar-EG', ar],
    ] as const) {
      for (const field of ['headline', 'sub'] as const) {
        const value = lookup(bundle, `engagements.stageAction.${key}.${field}`);
        expect(typeof value, `${name} · ${key}.${field}`).toBe('string');
        expect((value as string).length, `${name} · ${key}.${field}`).toBeGreaterThan(0);
      }
    }
  });
});
