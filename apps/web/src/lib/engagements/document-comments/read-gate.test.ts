import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@/lib/permissions/roles';

// A2: the thread read and the awaiting-reply count are callable directly (a
// server action, a loader), so the engagement page's own 404 is not their gate.
// Both answer "nothing" to a role without engagements_design/read, and do so
// without opening a transaction.

const database = vi.hoisted(() => ({ withOrgContext: vi.fn() }));
vi.mock('@/lib/db/context', () => database);

const { countAwaitingReplyCore } = await import('./awaiting-reply');
const { listDocumentCommentsCore } = await import('./thread');

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';
const ENGAGEMENT_ID = '22222222-2222-4222-8222-222222222222';
const THREAD = [
  { id: 'c-1', channel: 'client', authorUserId: null, authorName: 'Mona', body: 'Which tile?', createdAt: new Date(0) },
];

const ROLES_THAT_READ_DESIGN: MemberRole[] = ['owner', 'admin', 'project_manager', 'site_engineer', 'viewer'];
const ROLES_THAT_DO_NOT: MemberRole[] = ['accountant', 'client'];

function contextOf(role: MemberRole): OrgContext {
  return { orgId: 'org-1', userId: 'user-1', role };
}

beforeEach(() => {
  database.withOrgContext.mockReset();
});

describe('listDocumentCommentsCore', () => {
  it.each(ROLES_THAT_READ_DESIGN)('%s reads the thread', async (role) => {
    database.withOrgContext.mockResolvedValue(THREAD);
    expect(await listDocumentCommentsCore(contextOf(role), ARTIFACT_ID)).toEqual(THREAD);
    expect(database.withOrgContext).toHaveBeenCalledTimes(1);
  });

  it.each(ROLES_THAT_DO_NOT)('%s gets an empty thread and no query runs', async (role) => {
    database.withOrgContext.mockResolvedValue(THREAD);
    expect(await listDocumentCommentsCore(contextOf(role), ARTIFACT_ID)).toEqual([]);
    expect(database.withOrgContext).not.toHaveBeenCalled();
  });
});

describe('countAwaitingReplyCore', () => {
  it.each(ROLES_THAT_READ_DESIGN)('%s reads the count', async (role) => {
    database.withOrgContext.mockResolvedValue([{ n: 3 }]);
    expect(await countAwaitingReplyCore(contextOf(role), ENGAGEMENT_ID)).toBe(3);
    expect(database.withOrgContext).toHaveBeenCalledTimes(1);
  });

  it.each(ROLES_THAT_DO_NOT)('%s gets 0 and no query runs', async (role) => {
    database.withOrgContext.mockResolvedValue([{ n: 3 }]);
    expect(await countAwaitingReplyCore(contextOf(role), ENGAGEMENT_ID)).toBe(0);
    expect(database.withOrgContext).not.toHaveBeenCalled();
  });
});
