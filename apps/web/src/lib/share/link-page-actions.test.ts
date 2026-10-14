import { beforeEach, describe, expect, it, vi } from 'vitest';

// W3.6: the /p, /c and /v server actions never throw to the client. A write
// that gave up on a lock (it may still commit) answers `uncertain`; any other
// throw answers `generic` with the reference its one log line carries.

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'probe/1' }) }));

const boom = vi.hoisted(() => vi.fn());
vi.mock('@/lib/proposals/public', () => ({ respondToProposalByToken: boom }));
vi.mock('@/lib/variations/public', () => ({ respondToVariationByToken: boom }));
vi.mock('@/lib/contracts/public', () => ({
  acknowledgeContractByToken: boom,
  getContractByToken: async () => null,
  contractPayloadHash: () => 'hash',
}));

const { DbWriteUncertainError } = await import('@/lib/db/client');
const { respondToProposal } = await import('@/app/[locale]/p/[token]/actions');
const { acknowledgeContract } = await import('@/app/[locale]/c/[token]/actions');
const { respondToVariation } = await import('@/app/[locale]/v/[token]/actions');

const ACTS: Array<[string, () => Promise<unknown>]> = [
  ['respondToProposal', () => respondToProposal('tok', 'accept', 'Mona')],
  ['acknowledgeContract', () => acknowledgeContract('tok', 'Mona')],
  ['respondToVariation', () => respondToVariation('tok', 'approve', 'Mona')],
];

const LOCK_TIMEOUT = Object.assign(new Error('Failed query'), {
  cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
});

beforeEach(() => {
  boom.mockReset();
});

describe('a link page action whose write fails underneath', () => {
  it.each(ACTS)('%s: a lock timeout answers uncertain', async (_name, call) => {
    boom.mockRejectedValue(LOCK_TIMEOUT);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call()).toEqual({ ok: false, error: 'uncertain' });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it.each(ACTS)('%s: a write past the Workers deadline answers uncertain, never generic (R2)', async (_name, call) => {
    boom.mockRejectedValue(new DbWriteUncertainError());
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call()).toEqual({ ok: false, error: 'uncertain' });
    logged.mockRestore();
  });

  it.each(ACTS)('%s: any other throw answers generic with its log line reference', async (name, call) => {
    boom.mockRejectedValue(new Error('renderer crashed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = (await call()) as { reference?: string };
    expect(answer).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(/^[0-9A-Z]{8}$/) });
    expect(logged.mock.calls[0]).toEqual(['portal act failed', expect.objectContaining({ act: name, reference: answer.reference })]);
    logged.mockRestore();
  });
});
