import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// H6.4 (AC14): issuing hands the studio what it sends the client. An execution
// contract answers its client home (the link, the reason, or the refusal),
// never a /c link; a proposal contract answers its /c link, and no home is
// asked for. A committed issue is never reported as failed.

vi.mock('server-only', () => ({}));
const io = vi.hoisted(() => ({
  issueContractCore: vi.fn(),
  ensureClientHomeCore: vi.fn(),
  isIssuedExecutionContract: vi.fn(),
  origin: vi.fn(async (): Promise<string | null> => 'https://studio.example'),
  refreshApp: vi.fn(),
}));
vi.mock('./core', async (importOriginal) => ({ ...(await importOriginal<typeof import('./core')>()), issueContractCore: io.issueContractCore }));
vi.mock('@/lib/client-home/ensure', () => ({ ensureClientHomeCore: io.ensureClientHomeCore }));
vi.mock('./queries/lookups', () => ({ isIssuedExecutionContract: io.isIssuedExecutionContract }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: async () => ({ orgId: 'o-1', userId: 'u-1', role: 'owner' }) }));
vi.mock('@/lib/http/request-origin', () => ({ resolveRequestOrigin: io.origin }));
vi.mock('@/lib/actions/refresh', () => ({ refreshApp: io.refreshApp }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'ar-EG' }));

import { issueContract } from './actions';

const ID = '00000000-0000-4000-8000-0000000000c1';
const ORIGIN = 'https://studio.example';
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  for (const mock of [io.issueContractCore, io.ensureClientHomeCore, io.isIssuedExecutionContract, io.refreshApp]) mock.mockReset();
  io.origin.mockReset().mockResolvedValue(ORIGIN);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});

const issued = (execution: boolean) => io.issueContractCore.mockResolvedValue({ ok: true, data: { rawToken: 'c-raw', execution } });

describe('issueContract', () => {
  it("an execution contract: its home's Execution tab, and no /c link", async () => {
    issued(true);
    io.ensureClientHomeCore.mockResolvedValue({ ok: true, data: { engagementId: 'e-1', clientHasEmail: true, link: 'home-raw' } });
    const answer = await issueContract(ID);
    expect(answer).toEqual({ ok: true, clientHome: { ok: true, clientHasEmail: true, link: `${ORIGIN}/ar-EG/d/home-raw?tab=execution` } });
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
    expect(errors).toHaveBeenCalledWith('issueContract: issued, client home failed', { code: 'client_home_unavailable' });
    io.ensureClientHomeCore.mockRejectedValue(new Error('connection lost'));
    expect(await issueContract(ID)).toEqual({ ok: true, clientHome: { ok: false, error: 'generic', reference: expect.any(String) } });
    expect(errors).toHaveBeenCalledWith('issueContract: issued, client home failed', expect.objectContaining({ reference: expect.any(String) }));
  });

  it('a second tap on an issued BOQ contract: the same home, not a bare contract_not_draft (L4)', async () => {
    io.issueContractCore.mockResolvedValue({ ok: false, error: 'contract_not_draft' });
    io.isIssuedExecutionContract.mockResolvedValue(true);
    io.ensureClientHomeCore.mockResolvedValue({ ok: true, data: { engagementId: 'e-1', clientHasEmail: true, link: 'home-raw' } });
    expect(await issueContract(` ${ID} `)).toEqual({ ok: true, clientHome: { ok: true, clientHasEmail: true, link: `${ORIGIN}/ar-EG/d/home-raw?tab=execution` } });
    expect(io.isIssuedExecutionContract).toHaveBeenCalledWith(expect.anything(), ID);
    expect(io.refreshApp).toHaveBeenCalledTimes(1);
  });

  it('not a draft and no issued BOQ contract (signed, terminated, a proposal), or the read failed: the refusal as it came', async () => {
    io.issueContractCore.mockResolvedValue({ ok: false, error: 'contract_not_draft' });
    io.isIssuedExecutionContract.mockResolvedValue(false);
    expect(await issueContract(ID)).toEqual({ ok: false, error: 'contract_not_draft' });
    io.isIssuedExecutionContract.mockRejectedValue(new Error('connection lost'));
    expect(await issueContract(ID)).toEqual({ ok: false, error: 'contract_not_draft' });
    expect(errors).toHaveBeenCalledWith('issueContract: second tap read failed', expect.objectContaining({ message: 'connection lost' }));
    expect(io.ensureClientHomeCore).not.toHaveBeenCalled();
    expect(io.refreshApp).not.toHaveBeenCalled();
  });

  it('any other issue refusal is answered as it came, and nothing more is asked', async () => {
    io.issueContractCore.mockResolvedValue({ ok: false, error: 'contract_schedule_missing' });
    expect(await issueContract(ID)).toEqual({ ok: false, error: 'contract_schedule_missing' });
    expect(io.isIssuedExecutionContract).not.toHaveBeenCalled();
    expect(io.ensureClientHomeCore).not.toHaveBeenCalled();
    expect(io.refreshApp).not.toHaveBeenCalled();
  });

  it('no request origin: generic, and nothing is issued', async () => {
    io.origin.mockResolvedValue(null);
    expect(await issueContract(ID)).toEqual({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(io.issueContractCore).not.toHaveBeenCalled();
  });
});
