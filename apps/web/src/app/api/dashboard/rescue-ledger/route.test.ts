import { beforeEach, describe, expect, it, vi } from 'vitest';

// The rescue ledger route: a signed-in studio member only, the studio from the
// session and checked against the one the island was rendered for, the
// member's read budget, the window from ?range=, and nothing cached.

const deps = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireOrg: vi.fn(),
  loadRescueLedgerCore: vi.fn(),
  studioReadVerdict: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: deps.getSessionUser }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/dashboard/rescue-ledger/core', () => ({ loadRescueLedgerCore: deps.loadRescueLedgerCore }));
vi.mock('@/lib/cf/studio-read-rate-limit', () => ({ studioReadVerdict: deps.studioReadVerdict }));

const { GET } = await import('./route');

const CTX = { orgId: 'org-1', userId: 'user-1', role: 'owner' };
const LEDGER = { rangeMonths: 6, months: [] };
const get = (query = '?org=org-1') => GET(new Request(`https://metra.app/api/dashboard/rescue-ledger${query}`));

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.getSessionUser.mockResolvedValue({ id: 'user-1' });
  deps.requireOrg.mockResolvedValue(CTX);
  deps.loadRescueLedgerCore.mockResolvedValue({ ok: true, data: LEDGER });
  deps.studioReadVerdict.mockResolvedValue('allowed');
});

describe('GET /api/dashboard/rescue-ledger', () => {
  it('answers the ledger of the session studio, never cached, on the member budget', async () => {
    const response = await get('?range=12&org=org-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, ledger: LEDGER });
    expect(deps.loadRescueLedgerCore).toHaveBeenCalledWith(CTX, { range: 12 });
    expect(deps.studioReadVerdict).toHaveBeenCalledWith(CTX, 'rescue_ledger');
  });

  it.each([['?range=7&org=org-1'], ['?range=abc&org=org-1'], ['?org=org-1'], ['?range=&org=org-1']])('reads %s as the default 6 month window', async (query) => {
    await get(query);
    expect(deps.loadRescueLedgerCore).toHaveBeenCalledWith(CTX, { range: 6 });
  });

  it('refuses a signed out caller 401 before resolving any studio', async () => {
    deps.getSessionUser.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(deps.requireOrg).not.toHaveBeenCalled();
    expect(deps.loadRescueLedgerCore).not.toHaveBeenCalled();
  });

  it.each([['?org=org-2'], ['?range=6'], ['?org=']])('answers 409 when %s is not the active workspace, and reads nothing', async (query) => {
    const response = await get(query);
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'workspace_changed' });
    expect(deps.studioReadVerdict).not.toHaveBeenCalled();
    expect(deps.loadRescueLedgerCore).not.toHaveBeenCalled();
  });

  it('answers 429 with retry-after past the member budget, and reads nothing', async () => {
    deps.studioReadVerdict.mockResolvedValue('refused');
    const response = await get();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'rate_limited' });
    expect(deps.loadRescueLedgerCore).not.toHaveBeenCalled();
  });

  it('refuses rather than read unlimited when the binding is missing on Cloudflare', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deps.studioReadVerdict.mockResolvedValue('misdeployed');
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(deps.loadRescueLedgerCore).not.toHaveBeenCalled();
  });

  it('answers a refused role 403', async () => {
    deps.loadRescueLedgerCore.mockResolvedValue({ ok: false, error: 'forbidden' });
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('answers a failed read 500 with its reference only', async () => {
    deps.loadRescueLedgerCore.mockResolvedValue({ ok: false, error: 'generic', reference: 'ABC123' });
    const response = await get();
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: false, error: 'generic', reference: 'ABC123' });
  });
});
