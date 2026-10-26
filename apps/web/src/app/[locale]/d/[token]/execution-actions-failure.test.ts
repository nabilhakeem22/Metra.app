import { beforeEach, describe, expect, it, vi } from 'vitest';

// PR B4.3, H5: the payments' two server actions never throw to the client.
// A claim whose write gives up on a lock (55P03) answers `uncertain`, with ONE
// log line naming the act and the SQLSTATE and none of the failed query's
// parameters (the token hash, the code's hash, the IP, the user agent). A
// claim runs ONE token function and nothing after it (the page refreshes
// itself). A failed read is `generic` with the reference of its log line.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalActAllowed: async () => true, portalReadAllowed: async () => true }));

const LEAKY = Object.assign(
  new Error('Failed query: select public.app_home_claim_request_by_token(...) params: SECRET-HASH,req,chal,CODE-HASH,,,9.9.9.9,probe/1'),
  { cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', severity: 'ERROR' }) },
);
const reads = vi.hoisted(() => ({ claimRequestWithCodeByToken: vi.fn(), getDeliveryExecutionByToken: vi.fn() }));
vi.mock('@/lib/client-home/code-acts', () => ({ claimRequestWithCodeByToken: reads.claimRequestWithCodeByToken }));
vi.mock('@/lib/engagements/public/execution', () => ({ getDeliveryExecutionByToken: reads.getDeliveryExecutionByToken }));

const actions = await import('./execution-actions');
const TOKEN = 'portal-link-token';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const CLAIM = { requestId: REQUEST, challengeId: '22222222-2222-4222-8222-222222222222', code: '042917' };

beforeEach(() => {
  reads.claimRequestWithCodeByToken.mockReset();
  reads.getDeliveryExecutionByToken.mockReset();
});

const secretsIn = (line: string) => ['SECRET-HASH', 'CODE-HASH', '042917', '9.9.9.9', 'probe/1', TOKEN].filter((secret) => line.includes(secret));

describe('the claim', () => {
  it('a lock wait that gave up answers uncertain and logs one redacted line', async () => {
    reads.claimRequestWithCodeByToken.mockRejectedValue(LEAKY);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await actions.claimRequestInHome(TOKEN, CLAIM)).toEqual({ ok: false, error: 'uncertain' });
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(logged.mock.calls);
    expect(line).toContain('claimRequestInHome');
    expect(line).toContain('55P03');
    expect(secretsIn(line)).toEqual([]);
    logged.mockRestore();
  });

  it('passes the code with the request and the provenance, and reads nothing after it', async () => {
    reads.claimRequestWithCodeByToken.mockResolvedValue({ ok: true, already: false });
    expect(await actions.claimRequestInHome(TOKEN, CLAIM)).toEqual({ ok: true, already: false });
    expect(reads.claimRequestWithCodeByToken).toHaveBeenCalledWith(TOKEN, { ...CLAIM, ip: '9.9.9.9', userAgent: 'probe/1' });
    expect(reads.getDeliveryExecutionByToken).not.toHaveBeenCalled();
  });

  it('a refusal is answered as it came', async () => {
    reads.claimRequestWithCodeByToken.mockResolvedValue({ ok: false, error: 'code_wrong', attemptsLeft: 3 });
    expect(await actions.claimRequestInHome(TOKEN, CLAIM)).toEqual({ ok: false, error: 'code_wrong', attemptsLeft: 3 });
  });

  it('a direct call with no input is refused by the claim, never a throw', async () => {
    reads.claimRequestWithCodeByToken.mockResolvedValue({ ok: false, error: 'wrong_target' });
    expect(await actions.claimRequestInHome(TOKEN, undefined as never)).toEqual({ ok: false, error: 'wrong_target' });
    expect(reads.claimRequestWithCodeByToken).toHaveBeenCalledWith(TOKEN, {
      requestId: undefined,
      challengeId: undefined,
      code: undefined,
      ip: '9.9.9.9',
      userAgent: 'probe/1',
    });
  });
});

describe('the read', () => {
  it('a failure answers generic with the reference its one log line carries; a link with no card is gone', async () => {
    reads.getDeliveryExecutionByToken.mockRejectedValueOnce(new Error('pool closed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = (await actions.loadDeliveryExecution(TOKEN)) as { error: string; reference: string };
    expect(answer).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(/^[0-9A-Z]{8}$/) });
    expect(logged.mock.calls[0][1]).toMatchObject({ act: 'loadDeliveryExecution', reference: answer.reference });
    logged.mockRestore();
    reads.getDeliveryExecutionByToken.mockResolvedValueOnce(null);
    expect(await actions.loadDeliveryExecution(TOKEN)).toEqual({ ok: false, error: 'gone' });
  });
});
