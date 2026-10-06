import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '@/lib/permissions/member-roles';
import { canRunTrigger } from '../ui';
import { TRANSITIONS, type Trigger } from './index';
import { ENDING_DECIDERS, roleMayFire } from './trigger-roles';

const ENDINGS: Trigger[] = ['chooseDesignOnly', 'chooseExecution'];

describe('who may choose how a delivery ends (owner decision, Oct 6)', () => {
  it.each(ENDINGS)('%s: owner, admin and project_manager may; every other role may not', (trigger) => {
    const allowed = MEMBER_ROLES.filter((role) => canRunTrigger(role, trigger));
    expect([...allowed].sort()).toEqual(['admin', 'owner', 'project_manager']);
    for (const role of ['site_engineer', 'accountant', 'client', 'viewer'] as const) {
      expect(canRunTrigger(role, trigger), role).toBe(false);
      expect(roleMayFire(TRANSITIONS[trigger], role), role).toBe(false);
    }
  });

  it('no other trigger carries a role restriction', () => {
    const restricted = (Object.keys(TRANSITIONS) as Trigger[]).filter(
      (trigger) => TRANSITIONS[trigger].decidedBy !== undefined,
    );
    expect(restricted.sort()).toEqual([...ENDINGS].sort());
    for (const trigger of restricted) expect(TRANSITIONS[trigger].decidedBy).toBe(ENDING_DECIDERS);
  });
});
