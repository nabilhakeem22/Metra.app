import { beforeEach, describe, expect, it, vi } from 'vitest';

// The WhatsApp click record: a cookie-authenticated POST from this site's pages
// only, for a signed-in member, the workspace from the session.

const deps = vi.hoisted(() => ({ getSessionUser: vi.fn(), requireOrg: vi.fn(), recordWhatsappOpenedCore: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: deps.getSessionUser }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/engagements/reminder/whatsapp-opened', () => ({ recordWhatsappOpenedCore: deps.recordWhatsappOpenedCore }));

const { POST } = await import('./route');

const CTX = { orgId: 'org-1', userId: 'user-1', role: 'owner' };
const SAME_SITE = { origin: 'https://metra.app', host: 'metra.app' };
const post = (headers: Record<string, string>, body: unknown = { engagementId: 'e-1' }) =>
  POST(new Request('https://metra.app/api/delivery-reminder/whatsapp-opened', { method: 'POST', headers, body: JSON.stringify(body) }));

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.getSessionUser.mockResolvedValue({ id: 'user-1' });
  deps.requireOrg.mockResolvedValue(CTX);
  deps.recordWhatsappOpenedCore.mockResolvedValue({ ok: true });
});

describe('POST /api/delivery-reminder/whatsapp-opened', () => {
  it('records the click for the session workspace', async () => {
    const response = await post(SAME_SITE);
    expect(response.status).toBe(200);
    expect(deps.recordWhatsappOpenedCore).toHaveBeenCalledWith(CTX, 'e-1');
  });

  it('refuses another site, or no Origin, before reading the session', async () => {
    const refused: Array<Record<string, string>> = [{ origin: 'https://evil.example', host: 'metra.app' }, { host: 'metra.app' }];
    for (const headers of refused) {
      expect((await post(headers)).status).toBe(403);
    }
    expect(deps.getSessionUser).not.toHaveBeenCalled();
  });

  it('refuses a signed out caller 401', async () => {
    deps.getSessionUser.mockResolvedValue(null);
    expect((await post(SAME_SITE)).status).toBe(401);
    expect(deps.recordWhatsappOpenedCore).not.toHaveBeenCalled();
  });

  it('maps the core refusals, and a body that is not JSON reaches the core as no id', async () => {
    for (const [error, status] of [['forbidden', 403], ['malformed', 400], ['engagement_not_found', 404]] as const) {
      deps.recordWhatsappOpenedCore.mockResolvedValueOnce({ ok: false, error });
      expect((await post(SAME_SITE)).status).toBe(status);
    }
    deps.recordWhatsappOpenedCore.mockResolvedValueOnce({ ok: false, error: 'generic', reference: 'R1' });
    const failed = await post(SAME_SITE);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: 'generic', reference: 'R1' });
    const garbled = await POST(new Request('https://metra.app/x', { method: 'POST', headers: SAME_SITE, body: '{' }));
    expect(garbled.status).toBe(200);
    expect(deps.recordWhatsappOpenedCore).toHaveBeenLastCalledWith(CTX, undefined);
  });
});
