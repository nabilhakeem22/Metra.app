import { beforeEach, describe, expect, it, vi } from 'vitest';

// createOrg schedules the new studio's market price book for after its
// response, and only when the studio was created: a refused sign-up seeds
// nothing, and the seed is never awaited by the sign-up.

const deps = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  withUserContext: vi.fn(),
  createOrgCore: vi.fn(),
  seedAfterSignup: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: deps.getSessionUser }));
vi.mock('@/lib/db/context', () => ({ withUserContext: deps.withUserContext }));
vi.mock('./core', () => ({ createOrgCore: deps.createOrgCore }));
vi.mock('@/lib/market-book/seed-after-signup', () => ({ seedAfterSignup: deps.seedAfterSignup }));
vi.mock('next/navigation', () => ({ redirect: deps.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: vi.fn() }));

const { createOrg } = await import('./actions');

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.getSessionUser.mockResolvedValue({ id: 'user-1' });
  deps.withUserContext.mockResolvedValue([]);
});

describe('createOrg and the market price book', () => {
  it('schedules the seed for the new studio, as its owner, once it exists', async () => {
    deps.createOrgCore.mockResolvedValue({ ok: true });
    expect(await createOrg({ nameEn: 'Studio' })).toEqual({ ok: true });
    const [ctx] = deps.createOrgCore.mock.calls[0];
    expect(ctx).toMatchObject({ userId: 'user-1', role: 'owner' });
    expect(deps.seedAfterSignup.mock.calls).toEqual([[ctx]]);
  });

  it('seeds nothing when the studio was not created', async () => {
    deps.createOrgCore.mockResolvedValue({ ok: false, error: 'firm_type_unavailable' });
    expect(await createOrg({ nameEn: 'Studio' })).toEqual({ ok: false, error: 'firm_type_unavailable' });
    expect(deps.seedAfterSignup).not.toHaveBeenCalled();
  });
});
