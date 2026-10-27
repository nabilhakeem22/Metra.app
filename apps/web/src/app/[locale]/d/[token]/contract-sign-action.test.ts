import { beforeEach, describe, expect, it, vi } from 'vitest';

// H6.2: signing the contract in the home is a server action that never throws
// to the client. The link's ACT brake comes first (nothing read or written past
// it); then ONE code-checked act with the name, the code and where it came
// from. A sign whose write gave up on a lock answers `uncertain` with ONE log
// line that carries none of the failed query's parameters.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
const brake = vi.hoisted(() => ({ portalActAllowed: vi.fn(async () => true), portalReadAllowed: vi.fn(async () => true) }));
vi.mock('@/lib/share/portal-rate-limit', () => brake);
const acts = vi.hoisted(() => ({ signContractWithCodeByToken: vi.fn() }));
vi.mock('@/lib/client-home/code-acts', () => acts);

const { signContractInHome } = await import('./contract-actions');

const TOKEN = 'portal-link-token';
const SIGN = { contractId: '22222222-2222-4222-8222-222222222222', name: 'هشام عادل', code: '042917' };
const LEAKY = Object.assign(
  new Error('Failed query: select public.app_home_contract_ack_by_token(...) params: SECRET-HASH,c,CODE-HASH,name,9.9.9.9,probe/1,PDF'),
  { cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', severity: 'ERROR' }) },
);

beforeEach(() => {
  brake.portalActAllowed.mockReset().mockResolvedValue(true);
  acts.signContractWithCodeByToken.mockReset().mockResolvedValue({ ok: true, already: false });
});

describe('signContractInHome', () => {
  it('passes the contract, the name and the code with the provenance, and answers as the act did', async () => {
    expect(await signContractInHome(TOKEN, SIGN)).toEqual({ ok: true, already: false });
    expect(acts.signContractWithCodeByToken).toHaveBeenCalledWith(TOKEN, { ...SIGN, ip: '9.9.9.9', userAgent: 'probe/1' });
    acts.signContractWithCodeByToken.mockResolvedValue({ ok: false, error: 'name_required' });
    expect(await signContractInHome(TOKEN, SIGN)).toEqual({ ok: false, error: 'name_required' });
  });

  it('past the link brake: too_many for the link minute, and the act is never run', async () => {
    brake.portalActAllowed.mockResolvedValueOnce(false);
    expect(await signContractInHome(TOKEN, SIGN)).toEqual({ ok: false, error: 'too_many', retryAfterSeconds: 60, limit: 'link_minute' });
    expect(acts.signContractWithCodeByToken).not.toHaveBeenCalled();
  });

  it('a direct call with no input reaches the act with nothing, which refuses it, never a throw', async () => {
    acts.signContractWithCodeByToken.mockResolvedValue({ ok: false, error: 'wrong_target' });
    expect(await signContractInHome(TOKEN, undefined as never)).toEqual({ ok: false, error: 'wrong_target' });
    expect(acts.signContractWithCodeByToken).toHaveBeenCalledWith(TOKEN, {
      contractId: undefined,
      name: undefined,
      code: undefined,
      ip: '9.9.9.9',
      userAgent: 'probe/1',
    });
  });

  it('a lock wait that gave up is uncertain, any other failure generic with its reference; each ONE redacted log line', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    acts.signContractWithCodeByToken.mockRejectedValueOnce(LEAKY);
    expect(await signContractInHome(TOKEN, SIGN)).toEqual({ ok: false, error: 'uncertain' });
    acts.signContractWithCodeByToken.mockRejectedValueOnce(new Error('pool closed'));
    expect(await signContractInHome(TOKEN, SIGN)).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(/^[0-9A-Z]{8}$/) });
    expect(logged).toHaveBeenCalledTimes(2);
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain('signContractInHome');
    for (const secret of ['SECRET-HASH', 'CODE-HASH', '042917', '9.9.9.9', 'probe/1', TOKEN, 'هشام']) expect(lines).not.toContain(secret);
    logged.mockRestore();
  });
});
