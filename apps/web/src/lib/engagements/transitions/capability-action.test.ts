import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES } from '@/lib/permissions/roles';
import { CAPABILITY_ACTION } from './capability-action';
import { TRANSITIONS, type CapabilityKey } from './index';

// The map used to be declared twice — once in the server-only executor that
// ENFORCES it, once in the client-safe UI module that decides whether to offer
// the button. A drift between them is invisible to a type check (both copies
// type-check perfectly alone) and asymmetric in consequence: loosen the UI copy
// and the studio gets a button that always fails; tighten it and a permitted
// user silently loses an action.

describe('CAPABILITY_ACTION', () => {
  it('covers every capability family the registry actually uses', () => {
    const used = new Set(Object.values(TRANSITIONS).map((def) => def.capability));
    for (const capability of used) {
      expect(CAPABILITY_ACTION[capability]).toBeDefined();
    }
    // And nothing extra: an entry with no edge behind it is dead weight that a
    // reader would take for a live rule.
    for (const key of Object.keys(CAPABILITY_ACTION) as CapabilityKey[]) {
      expect(used.has(key)).toBe(true);
    }
  });

  it('gates the issue family on approve, which is the only action it is granted', () => {
    // engagements_issue mints a CLIENT-FACING artefact, so it is approve-only
    // (owner/admin). Gating it on 'update' would deny literally everyone, and
    // that is what a drifted copy would most plausibly have done.
    expect(CAPABILITY_ACTION.engagements_issue).toBe('approve');
    for (const role of MEMBER_ROLES) {
      expect(can(role, 'engagements_issue', 'update')).toBe(false);
    }
    expect(can('owner', 'engagements_issue', 'approve')).toBe(true);
  });

  it('gates design and finance on update, which someone can actually hold', () => {
    expect(CAPABILITY_ACTION.engagements_design).toBe('update');
    expect(CAPABILITY_ACTION.engagements_finance).toBe('update');
    expect(can('project_manager', 'engagements_design', 'update')).toBe(true);
    expect(can('accountant', 'engagements_finance', 'update')).toBe(true);
  });

  it('leaves no trigger ungateable — some role can run each one', () => {
    for (const [trigger, def] of Object.entries(TRANSITIONS)) {
      const action = CAPABILITY_ACTION[def.capability];
      const anyone = MEMBER_ROLES.some((role) => can(role, def.capability, action));
      expect(anyone, trigger).toBe(true);
    }
  });
});
