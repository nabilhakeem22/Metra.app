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

  it('Deliveries sits directly after Projects, gated on engagements_design', () => {
    const main = NAV_GROUPS[0].items.map((i) => i.key);
    expect(main.indexOf('deliveries')).toBe(main.indexOf('projects') + 1);
    const deliveries = allItems.find((i) => i.key === 'deliveries');
    expect(deliveries?.href).toBe('/engagements');
    expect(deliveries?.capability).toBe('engagements_design');
  });
});
