import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES, type MemberRole } from '@/lib/permissions/roles';
import { mayJoinSiteTeam, mayPublishSiteDiary, mayReadSiteLocation, mayWriteSiteDiary } from './access';

const RUN_THE_JOB: readonly MemberRole[] = ['owner', 'admin', 'project_manager'];

describe('site diary access gates', () => {
  it('coordinates: owner, admin and PM only', () => {
    for (const role of MEMBER_ROLES) expect(mayReadSiteLocation(role), role).toBe(RUN_THE_JOB.includes(role));
  });

  it('writing the diary: owner, admin, PM and the site engineer', () => {
    for (const role of MEMBER_ROLES) {
      expect(mayWriteSiteDiary(role), role).toBe([...RUN_THE_JOB, 'site_engineer'].includes(role));
    }
  });

  it('publishing to the client: owner, admin and PM only', () => {
    for (const role of MEMBER_ROLES) expect(mayPublishSiteDiary(role), role).toBe(RUN_THE_JOB.includes(role));
  });

  it('joining a site team: every internal role, never the client', () => {
    for (const role of MEMBER_ROLES) expect(mayJoinSiteTeam(role), role).toBe(role !== 'client');
  });

  it('the accountant and the viewer get none of them', () => {
    for (const role of ['accountant', 'viewer'] as const) {
      expect([mayReadSiteLocation(role), mayWriteSiteDiary(role), mayPublishSiteDiary(role)]).toEqual([false, false, false]);
    }
  });

  it('the client gets none of them', () => {
    expect([mayReadSiteLocation('client'), mayWriteSiteDiary('client'), mayPublishSiteDiary('client')]).toEqual([false, false, false]);
  });
});
