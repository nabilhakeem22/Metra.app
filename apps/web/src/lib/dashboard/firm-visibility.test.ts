import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '@/lib/permissions/member-roles';
import type { MemberRole } from '@/lib/permissions/roles';
import { canSeeFirmFigures } from './firm-visibility';

// 7 roles x 2 settings = 14 cases, and the table below IS the policy. The
// Sep-12 finding was that `grep -rn firm_dashboard apps/web/src` returned the
// capability, the matrix row, and ZERO readers: a studio that turned the setting
// ON was told "Limit firm-wide figures to owners and admins" and nothing changed,
// while a project_manager — who holds the EMPTY cell for firm_dashboard — saw
// every firm-wide count and both charts either way.
const EXPECTED: Record<MemberRole, { off: boolean; on: boolean }> = {
  owner: { off: true, on: true },
  admin: { off: true, on: true },
  // Granted R by §2.2, and the setting is what SUBTRACTS them.
  accountant: { off: true, on: false },
  viewer: { off: true, on: false },
  // NOT granted at all. The setting is irrelevant to them: the base grant is
  // what fences them, and this is the live behaviour change (A3).
  project_manager: { off: false, on: false },
  site_engineer: { off: false, on: false },
  // Never reaches the page (require-org.ts notFound()s the (app) group), and
  // answers false here regardless.
  client: { off: false, on: false },
};

describe('canSeeFirmFigures', () => {
  it('covers every role the product has, with no role left unasserted', () => {
    // If a role is added to the matrix and not to the table above, this fails
    // instead of the new role silently inheriting whatever the predicate does.
    expect([...MEMBER_ROLES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [role, expected] of Object.entries(EXPECTED) as Array<
    [MemberRole, { off: boolean; on: boolean }]
  >) {
    it(`${role}: ${expected.off} with the toggle OFF, ${expected.on} with it ON`, () => {
      expect(
        canSeeFirmFigures(role, { restrictFirmDashboard: false }),
      ).toBe(expected.off);
      expect(canSeeFirmFigures(role, { restrictFirmDashboard: true })).toBe(
        expected.on,
      );
    });
  }

  it('the setting can only ever NARROW, never widen', () => {
    // A role refused with the toggle off must stay refused with it on. This is
    // the property that makes the two gates safe to compose in either order.
    for (const role of MEMBER_ROLES) {
      if (!canSeeFirmFigures(role, { restrictFirmDashboard: false })) {
        expect(canSeeFirmFigures(role, { restrictFirmDashboard: true })).toBe(false);
      }
    }
  });
});
