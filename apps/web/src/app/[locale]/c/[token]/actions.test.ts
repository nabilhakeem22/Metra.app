import { beforeEach, describe, expect, test, vi } from 'vitest';

// PR A3.6, AC11: /c's "show more" reads spend the link's read budget; past it,
// or for a section that answers nothing, the answer says so, and the action
// never throws to the page. A3 reliability R1: "show more sections" likewise.
// H6.3 (AC8): a BOQ contract answers `moved` and is never sent to the
// acknowledgement; a proposal contract, and a token with no snapshot, are sent
// as before. P4a: the acknowledgement spends the link's ACT budget first; past
// it the answer is `too_many`, and the contract is neither read nor sent.

vi.mock('server-only', () => ({}));
const reads = vi.hoisted(() => ({ allowed: vi.fn(async () => true), page: vi.fn(), sections: vi.fn() }));
const ack = vi.hoisted(() => ({ allowed: vi.fn(async () => true), snapshot: vi.fn(), send: vi.fn(), hash: vi.fn() }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalActAllowed: ack.allowed, portalReadAllowed: reads.allowed }));
vi.mock('@/lib/contracts/public', () => ({
  getContractSectionLinesByToken: reads.page,
  getContractSectionsByToken: reads.sections,
  acknowledgeContractByToken: ack.send,
  contractPayloadHash: ack.hash,
  getContractByToken: ack.snapshot,
}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '10.0.0.1', userAgent: 'ua' }) }));

const { acknowledgeContract, loadContractSectionLines, loadContractSections } = await import('./actions');

beforeEach(() => {
  reads.allowed.mockReset().mockResolvedValue(true);
  reads.page.mockReset();
  reads.sections.mockReset();
  ack.allowed.mockReset().mockResolvedValue(true);
  ack.snapshot.mockReset();
  ack.send.mockReset().mockResolvedValue({ ok: true });
  ack.hash.mockReset().mockReturnValue('h'.repeat(64));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('acknowledgeContract: where a contract is signed (H6.3, AC8)', () => {
  test('a BOQ contract answers moved, and nothing is sent to the acknowledgement', async () => {
    ack.snapshot.mockResolvedValue({ source: 'boq', status: 'issued' });
    for (const name of ['Client', 42, 'x'.repeat(10_000), '‮RLO']) {
      expect(await acknowledgeContract('t', name as string)).toEqual({ ok: false, error: 'moved' });
    }
    expect(ack.send).not.toHaveBeenCalled();
    expect(ack.hash).not.toHaveBeenCalled();
  });

  test('a proposal contract is sent once, with the hash of its own snapshot', async () => {
    const snapshot = { source: 'proposal', status: 'issued' };
    ack.snapshot.mockResolvedValue(snapshot);
    expect(await acknowledgeContract('t', ' Client ')).toEqual({ ok: true });
    expect(ack.hash).toHaveBeenCalledWith(snapshot);
    expect(ack.send).toHaveBeenCalledTimes(1);
    expect(ack.send).toHaveBeenCalledWith('t', { actorName: 'Client', ip: '10.0.0.1', userAgent: 'ua', pdfHash: 'h'.repeat(64) });
  });

  test('a token with no snapshot is sent as before, with no hash', async () => {
    ack.snapshot.mockResolvedValue(null);
    ack.send.mockResolvedValue({ ok: false, error: 'token_invalid' });
    expect(await acknowledgeContract('t', 'Client')).toEqual({ ok: false, error: 'token_invalid' });
    expect(ack.send).toHaveBeenCalledWith('t', { actorName: 'Client', ip: '10.0.0.1', userAgent: 'ua', pdfHash: null });
  });
});

describe('acknowledgeContract: the link act budget (P4a)', () => {
  test('past the budget: too_many, and the contract is neither read nor sent', async () => {
    ack.allowed.mockResolvedValue(false);
    ack.snapshot.mockResolvedValue({ source: 'proposal', status: 'issued' });
    expect(await acknowledgeContract('t', 'Client')).toEqual({ ok: false, error: 'too_many' });
    expect(ack.allowed).toHaveBeenCalledWith('t');
    expect(ack.snapshot).not.toHaveBeenCalled();
    expect(ack.hash).not.toHaveBeenCalled();
    expect(ack.send).not.toHaveBeenCalled();
    expect(reads.allowed).not.toHaveBeenCalled();
  });

  test('within the budget the act is charged once, to the act budget, before the contract is read', async () => {
    const order: string[] = [];
    ack.allowed.mockImplementation(async () => (order.push('budget'), true));
    ack.snapshot.mockImplementation(async () => (order.push('read'), { source: 'proposal', status: 'issued' }));
    expect(await acknowledgeContract('t', 'Client')).toEqual({ ok: true });
    expect(order).toEqual(['budget', 'read']);
    expect(ack.allowed).toHaveBeenCalledTimes(1);
    expect(reads.allowed).not.toHaveBeenCalled();
  });

  test('a limiter that rejects (its binding missing on Cloudflare) is the referenced generic, and nothing is sent', async () => {
    ack.allowed.mockRejectedValue(new Error('Rate limiting binding PORTAL_ACT_RATE_LIMITER is missing'));
    expect(await acknowledgeContract('t', 'Client')).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(ack.send).not.toHaveBeenCalled();
  });
});

describe('loadContractSectionLines', () => {
  test('past the read budget: too_many, and the page is never read', async () => {
    reads.allowed.mockResolvedValue(false);
    expect(await loadContractSectionLines('t', 's-1', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.page).not.toHaveBeenCalled();
  });

  test('a section that answers nothing is gone; a failure underneath is generic with a reference', async () => {
    reads.page.mockResolvedValue(null);
    expect(await loadContractSectionLines('t', 's-x', 0)).toEqual({ ok: false, error: 'gone' });
    reads.page.mockRejectedValue(new Error('boom'));
    expect(await loadContractSectionLines('t', 's-1', 0)).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
  });
});

describe('loadContractSections', () => {
  test('past the read budget: too_many, unread; nothing to show: gone', async () => {
    reads.allowed.mockResolvedValueOnce(false);
    expect(await loadContractSections('t', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.sections).not.toHaveBeenCalled();
    reads.sections.mockResolvedValue(null);
    expect(await loadContractSections('t', 50)).toEqual({ ok: false, error: 'gone' });
  });
});
