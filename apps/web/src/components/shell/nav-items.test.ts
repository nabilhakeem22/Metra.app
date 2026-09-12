import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from './nav-items';

const allItems = NAV_GROUPS.flatMap((g) => g.items);

describe('sidebar nav capabilities', () => {
  it('Team is gated on users_settings so non-admins never see the link', () => {
    const team = allItems.find((i) => i.key === 'team');
    expect(team?.capability).toBe('users_settings');
  });

  it('only dashboard and settings are links with no capability gate', () => {
    const ungated = allItems
      .filter((i) => i.href && !i.capability)
      .map((i) => i.key);
    expect(ungated).toEqual(['dashboard', 'settings']);
  });
});
