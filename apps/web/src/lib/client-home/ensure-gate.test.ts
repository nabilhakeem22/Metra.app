import { describe, expect, it, vi } from 'vitest';
import { DELIVERY_LINK_GATE } from '@/lib/engagements/share-reveal';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES } from '@/lib/permissions/roles';

vi.mock('server-only', () => ({}));

const { CLIENT_HOME_GATE } = await import('./ensure');

// H4 follow-up F6: ensureClientHomeCore hands back the home's link with no
// share check of its own, because every role that may open a client home may
// also share delivery links. A matrix change that broke this would hand a link
// to a role that may not share one, so it fails here first.
describe('the client home gate', () => {
  it.each(MEMBER_ROLES)('%s: opening a client home implies sharing delivery links', (role) => {
    if (!can(role, CLIENT_HOME_GATE.capability, CLIENT_HOME_GATE.action)) return;
    expect(can(role, DELIVERY_LINK_GATE.capability, DELIVERY_LINK_GATE.action)).toBe(true);
  });

  it('is owner and admin only', () => {
    expect(MEMBER_ROLES.filter((role) => can(role, CLIENT_HOME_GATE.capability, CLIENT_HOME_GATE.action))).toEqual(['owner', 'admin']);
  });
});
