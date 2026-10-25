import { describe, expect, it } from 'vitest';
import type { MemberRole } from '@/lib/permissions/roles';
import { postLoginPathOf } from './post-login-rule';

// Where a sign-in lands (plan C3 "Post-login", AC8). The two /site rules apply
// only while the site app is live; until PR S4 ships it, everyone lands where
// they did before.

const LIVE = { siteAppLive: true };
const FROM_SITE_APP = { returnTo: 'site' as const, siteAppLive: true };
const NOT_LIVE = { siteAppLive: false };

describe('postLoginPathOf, with the site app live', () => {
  it('sends the site app login link (return=site) to /site, whatever the memberships', () => {
    const cases: Array<readonly MemberRole[] | null> = [['owner'], ['site_engineer'], [], null];
    for (const roles of cases) expect(postLoginPathOf(roles, FROM_SITE_APP), String(roles)).toBe('/site');
  });

  it('sends a person whose every internal membership is site engineer to /site', () => {
    expect(postLoginPathOf(['site_engineer'], LIVE)).toBe('/site');
    expect(postLoginPathOf(['site_engineer', 'site_engineer'], LIVE)).toBe('/site');
    expect(postLoginPathOf(['site_engineer', 'client'], LIVE), 'a client membership is not internal').toBe('/site');
  });

  it('keeps anyone with another internal role on the dashboard', () => {
    expect(postLoginPathOf(['owner'], LIVE)).toBe('/dashboard');
    expect(postLoginPathOf(['site_engineer', 'project_manager'], LIVE)).toBe('/dashboard');
    expect(postLoginPathOf(['viewer'], LIVE)).toBe('/dashboard');
    expect(postLoginPathOf(['client'], LIVE), 'only a client membership: requireOrg decides there').toBe('/dashboard');
  });

  it('sends a person with no membership to onboarding, and an unread probe to the dashboard', () => {
    expect(postLoginPathOf([], LIVE)).toBe('/onboarding');
    expect(postLoginPathOf(null, LIVE)).toBe('/dashboard');
  });
});

describe('postLoginPathOf, before the site app is live', () => {
  it('never lands on /site', () => {
    expect(postLoginPathOf(['site_engineer'], NOT_LIVE)).toBe('/dashboard');
    expect(postLoginPathOf(['site_engineer'], { ...NOT_LIVE, returnTo: 'site' })).toBe('/dashboard');
    expect(postLoginPathOf([], { ...NOT_LIVE, returnTo: 'site' })).toBe('/onboarding');
    expect(postLoginPathOf(null, { ...NOT_LIVE, returnTo: 'site' })).toBe('/dashboard');
  });

  it('lands an owner on the dashboard', () => {
    expect(postLoginPathOf(['owner'], NOT_LIVE)).toBe('/dashboard');
  });
});
