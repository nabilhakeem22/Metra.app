import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '@/lib/permissions/member-roles';
import type { MemberRole } from '@/lib/permissions/roles';
import { canSeeRescueLedger } from './visibility';

// 7 roles x 2 settings, and the table IS owner decision D1: the finance roles
// (owner, admin, accountant), narrowed to owner and admin when the studio limits
// firm-wide figures.
const EXPECTED: Record<MemberRole, { off: boolean; on: boolean }> = {
  owner: { off: true, on: true },
  admin: { off: true, on: true },
  accountant: { off: true, on: false },
  // Holds read-only finance and firm figures, and D1 still leaves it out.
  viewer: { off: false, on: false },
  project_manager: { off: false, on: false },
  site_engineer: { off: false, on: false },
  client: { off: false, on: false },
};

describe('canSeeRescueLedger', () => {
  it('covers every role the product has', () => {
    expect([...MEMBER_ROLES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [role, expected] of Object.entries(EXPECTED) as Array<[MemberRole, { off: boolean; on: boolean }]>) {
    it(`${role}: ${expected.off} with the limit OFF, ${expected.on} with it ON`, () => {
      expect(canSeeRescueLedger(role, { restrictFirmDashboard: false })).toBe(expected.off);
      expect(canSeeRescueLedger(role, { restrictFirmDashboard: true })).toBe(expected.on);
    });
  }
});
