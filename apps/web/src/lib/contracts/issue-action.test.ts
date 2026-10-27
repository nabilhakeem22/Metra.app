import { beforeEach, describe, expect, it, vi } from 'vitest';

// H6.4 (AC14): issuing hands the studio what it sends the client. An execution
// contract answers its client home (the link, the reason, or the refusal),
// never a /c link; a proposal contract answers its /c link, and no home is
// asked for. A committed issue is never reported as failed.

vi.mock('server-only', () => ({}));
const io = vi.hoisted(() => ({
  issueContractCore: vi.fn(),
  ensureClientHomeCore: vi.fn(),
  origin: vi.fn(async (): Promise<string | null> => 'https://studio.example'),
  refreshApp: vi.fn(),
}));
vi.mock('./core', async (importOriginal) => ({ ...(await importOriginal<typeof import('./core')>()), issueContractCore: io.issueContractCore }));
vi.mock('@/lib/client-home/ensure', () => ({ ensureClientHomeCore: io.ensureClientHomeCore }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: async () => ({ orgId: 'o-1', userId: 'u-1', role: 'owner' }) }));
vi.mock('@/lib/http/request-origin', () => ({ resolveRequestOrigin: io.origin }));
vi.mock('@/lib/actions/refresh', () => ({ refreshApp: io.refreshApp }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'ar-EG' }));

import { issueContract } from './actions';

const ID = '00000000-0000-4000-8000-0000000000c1';
const ORIGIN = 'https://studio.example';

beforeEach(() => {
  for (const mock of [io.issueContractCore, io.ensureClientHomeCore, io.refreshApp]) mock.mockReset();
  io.origin.mockReset().mockResolvedValue(ORIGIN);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const issued = (execution: boolean) => io.issueContractCore.mockResolvedValue({ ok: true, data: { rawToken: 'c-raw', execution } });

describe('issueContract', () => {
  it("an execution contract: its home's Execution tab, and no /c link", async () => {
    issued(true);
    io.ensureClientHomeCore.mockResolvedValue({ ok: true, data: { engagementId: 'e-1', link: 'home-raw' } });
    const answer = await issueContract(ID);
    expect(answer).toEqual({ ok: true, clientHome: { ok: true, link: `${ORIGIN}/ar-EG/d/home-raw?tab=execution` } });
    expect(answer).not.toHaveProperty('link');
    expect(io.ensureClientHomeCore).toHaveBeenCalledWith(expect.anything(), { contractId: ID });
    expect(io.refreshApp).toHaveBeenCalledTimes(1);
  });

  it('a proposal contract: its /c link, and no home is asked for', async () => {
    issued(false);
    expect(await issueContract(ID)).toEqual({ ok: true, link: `${ORIGIN}/ar-EG/c/c-raw` });
    expect(io.ensureClientHomeCore).not.toHaveBeenCalled();
    expect(io.refreshApp).toHaveBeenCalledTimes(1);
  });

  it('a home refused, or a home that threw, is still an issued contract', async () => {
    issued(true);
    io.ensureClientHomeCore.mockResolvedValue({ ok: false, error: 'client_home_unavailable' });
    expect(await issueContract(ID)).toEqual({ ok: true, clientHome: { ok: false, error: 'client_home_unavailable' } });
    io.ensureClientHomeCore.mockRejectedValue(new Error('connection lost'));
    expect(await issueContract(ID)).toEqual({ ok: true, clientHome: { ok: false, error: 'generic', reference: expect.any(String) } });
  });

  it('an issue refusal is answered as it came, and no home is asked for', async () => {
    io.issueContractCore.mockResolvedValue({ ok: false, error: 'contract_not_draft' });
    expect(await issueContract(ID)).toEqual({ ok: false, error: 'contract_not_draft' });
    expect(io.ensureClientHomeCore).not.toHaveBeenCalled();
    expect(io.refreshApp).not.toHaveBeenCalled();
  });

  it('no request origin: generic, and nothing is issued', async () => {
    io.origin.mockResolvedValue(null);
    expect(await issueContract(ID)).toEqual({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(io.issueContractCore).not.toHaveBeenCalled();
  });
});
