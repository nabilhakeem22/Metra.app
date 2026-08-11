import { describe, expect, it } from 'vitest';
import { buildChecklist } from './checklist';
import type { OnboardingProgress } from './progress';

const NONE: OnboardingProgress = {
  profileComplete: false,
  teamInvited: false,
  hasCostItem: false,
  hasClient: false,
  hasProject: false,
  hasProposal: false,
  hasSentProposal: false,
};

describe('buildChecklist', () => {
  it('viewer (no create grants) -> items:[] , percent 0, not allDone', () => {
    const r = buildChecklist(NONE, 'viewer', false);
    expect(r.items).toEqual([]);
    expect(r.percent).toBe(0);
    expect(r.allDone).toBe(false);
  });

  it('owner gets all six steps in order', () => {
    const r = buildChecklist(NONE, 'owner', false);
    expect(r.items.map((i) => i.key)).toEqual([
      'completeProfile',
      'addClient',
      'addProject',
      'addCostItem',
      'buildProposal',
      'sendProposal',
    ]);
    expect(r.percent).toBe(0);
  });

  it('project_manager only gets the steps it can do (clients/projects/build)', () => {
    const r = buildChecklist(NONE, 'project_manager', false);
    expect(r.items.map((i) => i.key)).toEqual([
      'addClient',
      'addProject',
      'buildProposal',
    ]);
  });

  it('percent counts only INCLUDED items; allDone when every included item is done', () => {
    // PM has 3 items; mark 2 done -> 67%.
    const p: OnboardingProgress = { ...NONE, hasClient: true, hasProject: true };
    const r = buildChecklist(p, 'project_manager', false);
    expect(r.percent).toBe(67);
    expect(r.allDone).toBe(false);

    const done = buildChecklist(
      { ...NONE, hasClient: true, hasProject: true, hasProposal: true },
      'project_manager',
      false,
    );
    expect(done.percent).toBe(100);
    expect(done.allDone).toBe(true);
  });
});
