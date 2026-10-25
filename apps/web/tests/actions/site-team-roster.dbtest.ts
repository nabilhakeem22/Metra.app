import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTeamTab } from '@/app/[locale]/(app)/projects/[id]/team-tab-data';
import { searchSiteTeamCandidatesCore } from '@/lib/site/assignments/candidates';
import { SITE_TEAM_CANDIDATES_PER_CALL, SITE_TEAM_LIST_LIMIT, type SiteTeamPerson } from '@/lib/site/assignments/types';
import { closeExecutionFixture, seedClientProject } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { seedAssignment, seedMember } from './site-fixture';

// The S3 fix round's roster rulings, against a studio of 66 internal members
// (6 named roles and 60 engineers, as the security test measured) and a client:
//   S2: a reader of the Team tab (site engineer, viewer) receives the site team
//       only, never the roster;
//   S3: a render looks up only the people it renders (the team, at most
//       SITE_TEAM_LIST_LIMIT), and the manager's picker asks for candidates a
//       page at a time, at most SITE_TEAM_CANDIDATES_PER_CALL lookups per call.
// Each identity lookup (one Supabase admin call, one subrequest on Workers) is
// counted by the double below.

const identity = vi.hoisted(() => ({
  lookups: [] as string[],
  people: new Map<string, { name: string | null; email: string | null }>(),
}));
vi.mock('@/lib/team/actor-identity', () => ({
  lookupActorIdentity: async (userId: string) => {
    identity.lookups.push(userId);
    return identity.people.get(userId) ?? { name: null, email: null };
  },
}));

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let projectId: string;
let otherOrgProjectId: string;
const memberOf = {} as Record<MemberRole, string>;
const engineers: string[] = [];
let onTeam: string[];
let clientId: string;
let otherStudioEngineer: string;

function named(userId: string, name: string, email: string): string {
  identity.people.set(userId, { name, email });
  return userId;
}

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = named(seeded.ownerIds[0], 'Yasmine Fouad', 'yasmine@noon.example');
  const other = await seedOrg({ owners: 1 });
  orgIds.push(orgId, other.orgId);
  for (const role of ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer'] as MemberRole[]) {
    memberOf[role] = named(await seedMember(orgId, role), `Named ${role}`, `${role}@noon.example`);
  }
  for (let index = 0; index < 60; index += 1) {
    engineers.push(named(await seedMember(orgId, 'site_engineer'), `Engineer ${index}`, `engineer${index}@noon.example`));
  }
  named(engineers[41], 'Laila Fathy', 'laila@noon.example');
  clientId = named(await seedMember(orgId, 'client'), 'Client Person', 'client@noon.example');
  otherStudioEngineer = named(await seedMember(other.orgId, 'site_engineer'), 'Other Studio', 'other@else.example');
  ({ projectId } = await seedClientProject(orgId));
  ({ projectId: otherOrgProjectId } = await seedClientProject(other.orgId));
  onTeam = [engineers[0], memberOf.project_manager];
  for (const userId of onTeam) await seedAssignment(orgId, projectId, userId, ownerId);
});

beforeEach(() => {
  identity.lookups.length = 0;
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const ctxOf = (role: MemberRole) => ctxFor(orgId, role === 'owner' ? ownerId : memberOf[role], role);

describe('loadTeamTab renders the site team only (S2) and looks up only who it renders (S3)', () => {
  it.each<MemberRole>(['site_engineer', 'viewer'])('a %s receives the two on the team, named, without emails, and nobody else', async (role) => {
    const data = await loadTeamTab(ctxOf(role), projectId);
    if (data.access === 'none') throw new Error('a reader reads the team');
    expect(data.access).toBe('read');
    expect(data.members.map((member) => member.userId)).toEqual(onTeam);
    expect(data.members.map((member) => [member.name, member.email])).toEqual([
      ['Engineer 0', null],
      ['Named project_manager', null],
    ]);
    expect(identity.lookups.sort()).toEqual([...onTeam].sort());
    const payload = JSON.stringify(data);
    const offTheTeam = [...engineers.slice(1), memberOf.admin, memberOf.viewer, memberOf.accountant, memberOf.site_engineer, ownerId, clientId];
    for (const userId of offTheTeam.filter((id) => id !== memberOf[role])) expect(payload).not.toContain(userId);
  });

  it('a manager receives the team with emails, and the render looks up the team only (2 of 66)', async () => {
    const data = await loadTeamTab(ctxOf('owner'), projectId);
    if (data.access !== 'manage') throw new Error('the owner manages the team');
    expect(data.members.map((member) => member.email)).toEqual(['engineer0@noon.example', 'project_manager@noon.example']);
    expect(identity.lookups).toHaveLength(2);
    expect(data.notShown).toBe(0);
  });

  it('the accountant is told the team does not show for his role: no read, no lookup', async () => {
    expect(await loadTeamTab(ctxOf('accountant'), projectId)).toEqual({ access: 'none' });
    expect(identity.lookups).toEqual([]);
  });

  it(`a team longer than ${SITE_TEAM_LIST_LIMIT} renders ${SITE_TEAM_LIST_LIMIT}, counts the rest, and looks up ${SITE_TEAM_LIST_LIMIT}`, async () => {
    const { projectId: crowded } = await seedClientProject(orgId);
    for (const userId of engineers.slice(0, SITE_TEAM_LIST_LIMIT + 5)) await seedAssignment(orgId, crowded, userId, ownerId);
    const data = await loadTeamTab(ctxOf('admin'), crowded);
    if (data.access !== 'manage') throw new Error('the admin manages the team');
    expect(data.members).toHaveLength(SITE_TEAM_LIST_LIMIT);
    expect(data.notShown).toBe(5);
    expect(identity.lookups).toHaveLength(SITE_TEAM_LIST_LIMIT);
  });
});

describe('searchSiteTeamCandidatesCore: a page at a time, for managers only', () => {
  const ask = (role: MemberRole, input: unknown) => searchSiteTeamCandidatesCore(ctxOf(role), input);

  it.each<MemberRole>(['site_engineer', 'viewer', 'accountant', 'client'])('a %s is forbidden, and nothing is looked up', async (role) => {
    const ctx = role === 'client' ? ctxFor(orgId, clientId, 'client') : ctxOf(role);
    expect(await searchSiteTeamCandidatesCore(ctx, { projectId, query: '', offset: 0 })).toEqual({ ok: false, error: 'forbidden' });
    expect(identity.lookups).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['no input', null],
    ['a project id that is not a uuid', { projectId: 'p-1', query: '', offset: 0 }],
    ['no query', { projectId: randomUUID(), offset: 0 }],
    ['a negative offset', { projectId: randomUUID(), query: '', offset: -1 }],
    ['a fractional offset', { projectId: randomUUID(), query: '', offset: 1.5 }],
    ['an offset as text', { projectId: randomUUID(), query: '', offset: '0' }],
    ['an offset past any studio', { projectId: randomUUID(), query: '', offset: 10_001 }],
  ])('%s is malformed', async (_label, input) => {
    expect(await ask('owner', input)).toEqual({ ok: false, error: 'malformed' });
    expect(identity.lookups).toEqual([]);
  });

  it("another studio's project, or none, is project_not_found, with no lookup", async () => {
    expect(await ask('project_manager', { projectId: otherOrgProjectId, query: '', offset: 0 })).toEqual({ ok: false, error: 'project_not_found' });
    expect(await ask('project_manager', { projectId: randomUUID(), query: '', offset: 0 })).toEqual({ ok: false, error: 'project_not_found' });
    expect(identity.lookups).toEqual([]);
  });

  it('walks every candidate exactly once, never more than one page of lookups per call, never a client, a team member or another studio', async () => {
    const seen: SiteTeamPerson[] = [];
    let offset: number | null = 0;
    let calls = 0;
    while (offset !== null) {
      identity.lookups.length = 0;
      const result = await ask('project_manager', { projectId, query: '', offset });
      if (!result.ok || !result.data) throw new Error(JSON.stringify(result));
      expect(identity.lookups.length).toBeLessThanOrEqual(SITE_TEAM_CANDIDATES_PER_CALL);
      expect(result.data.candidates).toHaveLength(identity.lookups.length);
      seen.push(...result.data.candidates);
      offset = result.data.nextOffset;
      calls += 1;
    }
    const internal = [ownerId, ...Object.values(memberOf), ...engineers];
    const expected = internal.filter((userId) => !onTeam.includes(userId));
    expect(seen.map((person) => person.userId).sort()).toEqual(expected.sort());
    expect(new Set(seen.map((person) => person.userId)).size).toBe(seen.length);
    expect(calls).toBe(Math.ceil(expected.length / SITE_TEAM_CANDIDATES_PER_CALL));
    expect(seen.some((person) => [clientId, otherStudioEngineer].includes(person.userId))).toBe(false);
    expect(seen.find((person) => person.userId === memberOf.viewer)).toEqual({
      userId: memberOf.viewer,
      role: 'viewer',
      name: 'Named viewer',
      email: 'viewer@noon.example',
    });
  });

  it('a typed search answers the matches of the page it looked at, and the next offset to walk on', async () => {
    const first = await ask('owner', { projectId, query: 'lai', offset: 0 });
    expect(first).toEqual({ ok: true, data: { candidates: [], nextOffset: SITE_TEAM_CANDIDATES_PER_CALL } });
    expect(identity.lookups).toHaveLength(SITE_TEAM_CANDIDATES_PER_CALL);

    const found: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const result = await ask('owner', { projectId, query: 'LAILA', offset });
      if (!result.ok || !result.data) throw new Error(JSON.stringify(result));
      found.push(...result.data.candidates.map((person) => person.name ?? ''));
      offset = result.data.nextOffset;
    }
    expect(found).toEqual(['Laila Fathy']);
    expect((await ask('admin', { projectId, query: 'laila@noon', offset: 40 })).data?.candidates.map((person) => person.userId)).toEqual([
      engineers[41],
    ]);
  });

  it('a member who joins the team leaves the candidates', async () => {
    const { projectId: fresh } = await seedClientProject(orgId);
    const all = async () => {
      const ids: string[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const result = await ask('owner', { projectId: fresh, query: '', offset });
        ids.push(...(result.data?.candidates.map((person) => person.userId) ?? []));
        offset = result.data?.nextOffset ?? null;
      }
      return ids;
    };
    expect(await all()).toContain(engineers[5]);
    await seedAssignment(orgId, fresh, engineers[5], ownerId);
    expect(await all()).not.toContain(engineers[5]);
  });
});
