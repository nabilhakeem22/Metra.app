import { beforeEach, describe, expect, it, vi } from 'vitest';

// The seed route: a cookie-authenticated POST, so it answers only this site's
// pages, only a signed-in studio member, and the studio comes from the session.

const deps = vi.hoisted(() => ({ getSessionUser: vi.fn(), requireOrg: vi.fn(), seedNewStudioCore: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: deps.getSessionUser }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/market-book/seed-core', () => ({ seedNewStudioCore: deps.seedNewStudioCore }));

const { POST } = await import('./route');

const CTX = { orgId: 'org-1', userId: 'user-1', role: 'owner' };
const post = (headers: Record<string, string>) => POST(new Request('https://metra.app/api/price-book/market-seed', { method: 'POST', headers }));
const SAME_SITE = { origin: 'https://metra.app', host: 'metra.app' };

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.getSessionUser.mockResolvedValue({ id: 'user-1' });
  deps.requireOrg.mockResolvedValue(CTX);
  deps.seedNewStudioCore.mockResolvedValue({ ok: true, data: { book: 'ready', sections: 55, items: 447 } });
});

describe('POST /api/price-book/market-seed', () => {
  it('seeds the studio of the session and says what it added', async () => {
    const response = await post(SAME_SITE);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, book: 'ready', sections: 55, items: 447 });
    expect(deps.seedNewStudioCore).toHaveBeenCalledWith(CTX);
  });

  it('refuses a request from another site, or with no Origin, before reading the session', async () => {
    const refused: Array<Record<string, string>> = [{ origin: 'https://evil.example', host: 'metra.app' }, { host: 'metra.app' }, { origin: 'null', host: 'metra.app' }];
    for (const headers of refused) {
      expect((await post(headers)).status).toBe(403);
    }
    expect(deps.getSessionUser).not.toHaveBeenCalled();
    expect(deps.seedNewStudioCore).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    deps.getSessionUser.mockResolvedValue(null);
    expect((await post(SAME_SITE)).status).toBe(401);
    expect(deps.seedNewStudioCore).not.toHaveBeenCalled();
  });

  it('answers a role without price-book create 403, and a failure 500 with its reference only', async () => {
    deps.seedNewStudioCore.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    expect((await post(SAME_SITE)).status).toBe(403);
    deps.seedNewStudioCore.mockResolvedValueOnce({ ok: false, error: 'generic', reference: 'ABC123' });
    const failed = await post(SAME_SITE);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: 'generic', reference: 'ABC123' });
  });

  it('answers a seed that met the market book being rebuilt 503 with retry-after: nothing was written', async () => {
    deps.seedNewStudioCore.mockResolvedValueOnce({ ok: false, error: 'market_book_busy' });
    const busy = await post(SAME_SITE);
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('60');
    expect(await busy.json()).toEqual({ ok: false, error: 'market_book_busy' });
  });
});
