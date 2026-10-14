import { describe, expect, it, vi } from 'vitest';

// Round E F1: the proposal, contract and variation link actions are directly
// invokable with any JSON. A name that is not a string is no name: the act goes
// ahead without one and nothing throws before it.

// The actions now run through `answered`, a server-only module.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'probe/1' }) }));
const respond = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/proposals/public', () => ({ respondToProposalByToken: respond }));
vi.mock('@/lib/variations/public', () => ({ respondToVariationByToken: respond }));
vi.mock('@/lib/contracts/public', () => ({
  acknowledgeContractByToken: respond,
  getContractByToken: async () => null,
  contractPayloadHash: () => 'hash',
}));

const { respondToProposal } = await import('./p/[token]/actions');
const { respondToVariation } = await import('./v/[token]/actions');
const { acknowledgeContract } = await import('./c/[token]/actions');

describe('a client-link act with a name that is not a string', () => {
  it.each([[123], [{}], [['Mona']], [null]])('%j: the act runs with no name', async (name) => {
    respond.mockClear();
    expect(await respondToProposal('tok', 'accept', name as never)).toEqual({ ok: true });
    expect(await respondToVariation('tok', 'approve', name as never)).toEqual({ ok: true });
    expect(await acknowledgeContract('tok', name as never)).toEqual({ ok: true });
    for (const [, input] of respond.mock.calls as unknown as Array<[string, { actorName: unknown }]>) expect(input.actorName).toBeNull();
  });

  it('a string name is trimmed and kept', async () => {
    respond.mockClear();
    await respondToProposal('tok', 'accept', '  Mona  ');
    expect((respond.mock.calls[0] as unknown as [string, { actorName: string }])[1].actorName).toBe('Mona');
  });
});
