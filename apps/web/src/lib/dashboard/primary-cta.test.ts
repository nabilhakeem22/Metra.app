import { describe, expect, it } from 'vitest';
import { pickPrimaryCta } from './primary-cta';

const DONE = {
  profileComplete: true,
  teamInvited: true,
  hasClient: true,
  hasProject: true,
  hasEngagement: true,
};

describe('pickPrimaryCta', () => {
  it('an incomplete profile wins for every role', () => {
    for (const role of ['owner', 'project_manager', 'viewer'] as const) {
      expect(pickPrimaryCta(role, { ...DONE, profileComplete: false })).toEqual({
        messageKey: 'ctaCompleteProfile',
        href: '/settings',
      });
    }
  });

  it('owner with no invite yet is pushed to invite the team', () => {
    expect(pickPrimaryCta('owner', { ...DONE, teamInvited: false })).toEqual({
      messageKey: 'ctaInviteTeam',
      href: '/team',
    });
  });

  it('admin with the team invited manages it', () => {
    expect(pickPrimaryCta('admin', DONE)).toEqual({
      messageKey: 'ctaManageTeam',
      href: '/team',
    });
  });

  it('roles without users_settings never get a /team link', () => {
    for (const role of [
      'project_manager',
      'site_engineer',
      'accountant',
      'client',
      'viewer',
    ] as const) {
      expect(pickPrimaryCta(role, DONE)).toEqual({
        messageKey: 'cards.projects',
        href: '/projects',
      });
      expect(pickPrimaryCta(role, { ...DONE, teamInvited: false })).toEqual({
        messageKey: 'cards.projects',
        href: '/projects',
      });
    }
  });
});

describe('pickPrimaryCta — the setup ladder', () => {
  it('owner, profile done: client, then project, then delivery, then the team', () => {
    const none = { ...DONE, hasClient: false, hasProject: false, hasEngagement: false };
    expect(pickPrimaryCta('owner', none)).toEqual({
      messageKey: 'ctaAddClient',
      href: '/clients?new=1',
    });
    expect(pickPrimaryCta('owner', { ...none, hasClient: true })).toEqual({
      messageKey: 'ctaAddProject',
      href: '/projects?new=1',
    });
    expect(pickPrimaryCta('owner', { ...none, hasClient: true, hasProject: true })).toEqual({
      messageKey: 'ctaStartDelivery',
      href: '/engagements?new=1',
    });
    expect(pickPrimaryCta('owner', { ...DONE, teamInvited: false })).toEqual({
      messageKey: 'ctaInviteTeam',
      href: '/team',
    });
  });

  it('a viewer never receives a create link, at any rung', () => {
    for (const progress of [
      { ...DONE, hasClient: false, hasProject: false, hasEngagement: false },
      { ...DONE, hasProject: false, hasEngagement: false },
      { ...DONE, hasEngagement: false },
    ]) {
      expect(pickPrimaryCta('viewer', progress)).toEqual({
        messageKey: 'cards.projects',
        href: '/projects',
      });
    }
  });
});
