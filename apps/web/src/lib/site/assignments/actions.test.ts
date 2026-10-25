import { beforeEach, describe, expect, it, vi } from 'vitest';

// The site team's server actions: each refreshes the app when the list it
// shows changed. A removal answered entry_not_found (taken off elsewhere
// meanwhile) refreshes too, so the stale row leaves the page (S3 fix round, F3).

const deps = vi.hoisted(() => ({
  refreshApp: vi.fn(),
  requireOrg: vi.fn(),
  assignSiteMemberCore: vi.fn(),
  unassignSiteMemberCore: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/actions/refresh', () => ({ refreshApp: deps.refreshApp }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/cf/studio-read-rate-limit', () => ({ studioReadRefusal: vi.fn() }));
vi.mock('./candidates', () => ({ searchSiteTeamCandidatesCore: vi.fn() }));
vi.mock('./core', () => ({ assignSiteMemberCore: deps.assignSiteMemberCore, unassignSiteMemberCore: deps.unassignSiteMemberCore }));

const { assignSiteMember, unassignSiteMember } = await import('./actions');

const INPUT = { projectId: 'p-1', userId: 'u-1' };

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.requireOrg.mockResolvedValue({ orgId: 'org-1', userId: 'owner-1', role: 'owner' });
});

describe('unassignSiteMember', () => {
  it('refreshes after a removal, and after one already done elsewhere (entry_not_found)', async () => {
    deps.unassignSiteMemberCore.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'entry_not_found' });
    expect(await unassignSiteMember(INPUT)).toEqual({ ok: true });
    expect(await unassignSiteMember(INPUT)).toEqual({ ok: false, error: 'entry_not_found' });
    expect(deps.refreshApp).toHaveBeenCalledTimes(2);
  });

  it('does not refresh after another refusal', async () => {
    deps.unassignSiteMemberCore.mockResolvedValue({ ok: false, error: 'forbidden' });
    await unassignSiteMember(INPUT);
    expect(deps.refreshApp).not.toHaveBeenCalled();
  });
});

describe('assignSiteMember', () => {
  it('refreshes after an assign only', async () => {
    deps.assignSiteMemberCore.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'not_member' });
    await assignSiteMember(INPUT);
    await assignSiteMember(INPUT);
    expect(deps.refreshApp).toHaveBeenCalledTimes(1);
  });
});
