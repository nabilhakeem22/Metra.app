import { beforeEach, describe, expect, it, vi } from 'vitest';

// H6.4: the client home's link as the studio is handed it, shared by the
// contract page's "Client page" control and the contract's issue: the
// Execution tab's absolute URL in the studio's locale, why there is none, or
// the refusal, as ensureClientHomeCore answers.

vi.mock('server-only', () => ({}));
const ensure = vi.hoisted(() => ({ ensureClientHomeCore: vi.fn() }));
vi.mock('./ensure', () => ensure);
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));

import type { OrgContext } from '@/lib/db/context';
import { clientHomeAnswer } from './home-link';

const CTX = { orgId: 'o-1', userId: 'u-1', role: 'owner' } as unknown as OrgContext;
const CONTRACT_ID = '00000000-0000-4000-8000-0000000000c1';
const ORIGIN = 'https://studio.example';

beforeEach(() => {
  ensure.ensureClientHomeCore.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('clientHomeAnswer', () => {
  it("a home with a link: its Execution tab's URL in the studio's locale", async () => {
    ensure.ensureClientHomeCore.mockResolvedValue({ ok: true, data: { engagementId: 'e-1', link: 'home-raw' } });
    expect(await clientHomeAnswer(CTX, CONTRACT_ID, ORIGIN)).toEqual({ ok: true, link: `${ORIGIN}/en/d/home-raw?tab=execution` });
    expect(ensure.ensureClientHomeCore).toHaveBeenCalledWith(CTX, { contractId: CONTRACT_ID });
  });

  it('a home whose link cannot be shown: the reason', async () => {
    ensure.ensureClientHomeCore.mockResolvedValue({ ok: true, data: { engagementId: 'e-1', link: null, linkReason: 'delivery_links_not_configured' } });
    expect(await clientHomeAnswer(CTX, CONTRACT_ID, ORIGIN)).toEqual({ ok: true, link: null, linkReason: 'delivery_links_not_configured' });
  });

  it('a refusal as it came; an ok with no home is generic with a reference', async () => {
    ensure.ensureClientHomeCore.mockResolvedValue({ ok: false, error: 'client_home_unavailable' });
    expect(await clientHomeAnswer(CTX, CONTRACT_ID, ORIGIN)).toEqual({ ok: false, error: 'client_home_unavailable' });
    ensure.ensureClientHomeCore.mockResolvedValue({ ok: true });
    expect(await clientHomeAnswer(CTX, CONTRACT_ID, ORIGIN)).toEqual({ ok: false, error: 'generic', reference: expect.any(String) });
  });
});
