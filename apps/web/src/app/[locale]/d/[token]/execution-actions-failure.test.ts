import { beforeEach, describe, expect, it, vi } from 'vitest';

// PR B4.3: the execution card's two server actions never throw to the client.
// A claim whose write gives up on a lock (55P03, the SDF's 4 s lock_timeout)
// answers `uncertain`, with ONE log line naming the act and the SQLSTATE and
// none of the failed query's parameters (the token hash, the IP, the user
// agent). A claim that landed while the read after it failed still answers
// that it landed, without the card (the card reads itself). A failed read is
// `generic` with the reference of its log line.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalActAllowed: async () => true, portalReadAllowed: async () => true }));

const LEAKY = Object.assign(
  new Error('Failed query: select public.app_delivery_claim_request_by_token(...) params: SECRET-HASH,req,,,9.9.9.9,probe/1'),
  { cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', severity: 'ERROR' }) },
);
const reads = vi.hoisted(() => ({ claimExecutionRequestByToken: vi.fn(), getDeliveryExecutionByToken: vi.fn() }));
vi.mock('@/lib/engagements/public/execution', () => reads);

const actions = await import('./execution-actions');
const TOKEN = 'portal-link-token';
const REQUEST = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  reads.claimExecutionRequestByToken.mockReset();
  reads.getDeliveryExecutionByToken.mockReset();
});

const secretsIn = (line: string) => ['SECRET-HASH', '9.9.9.9', 'probe/1', TOKEN].filter((secret) => line.includes(secret));

describe('the claim', () => {
  it('a lock wait that gave up answers uncertain and logs one redacted line', async () => {
    reads.claimExecutionRequestByToken.mockRejectedValue(LEAKY);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await actions.claimExecutionRequest(TOKEN, REQUEST)).toEqual({ ok: false, error: 'uncertain' });
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(logged.mock.calls);
    expect(line).toContain('claimExecutionRequest');
    expect(line).toContain('55P03');
    expect(secretsIn(line)).toEqual([]);
    logged.mockRestore();
  });

  it('a claim that landed answers so even when the read after it fails, and logs that read once', async () => {
    reads.claimExecutionRequestByToken.mockResolvedValue({ ok: true, already: false });
    reads.getDeliveryExecutionByToken.mockRejectedValue(LEAKY);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await actions.claimExecutionRequest(TOKEN, REQUEST)).toEqual({ ok: true, already: false });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(secretsIn(JSON.stringify(logged.mock.calls))).toEqual([]);
    logged.mockRestore();
  });

  it('a refusal is answered as it came, with no read after it', async () => {
    reads.claimExecutionRequestByToken.mockResolvedValue({ ok: false, error: 'busy' });
    expect(await actions.claimExecutionRequest(TOKEN, REQUEST)).toEqual({ ok: false, error: 'busy' });
    expect(reads.getDeliveryExecutionByToken).not.toHaveBeenCalled();
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
