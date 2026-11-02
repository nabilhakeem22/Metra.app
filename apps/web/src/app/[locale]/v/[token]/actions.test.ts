import { beforeEach, describe, expect, it, vi } from 'vitest';

// H7.2 (AC19): /v's own decision serves a proposal contract's order only. A BOQ
// contract's answers `moved` before anything is written; a link with no document
// goes on to the SDF as before, whose code is the answer.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
const reads = vi.hoisted(() => ({ getVariationByToken: vi.fn(), respondToVariationByToken: vi.fn() }));
vi.mock('@/lib/variations/public', () => reads);

const { respondToVariation } = await import('./actions');

beforeEach(() => {
  reads.getVariationByToken.mockReset();
  reads.respondToVariationByToken.mockReset().mockResolvedValue({ ok: true });
});

describe('respondToVariation', () => {
  it.each(['approve', 'reject'] as const)('a BOQ order (%s): moved, and the respond SDF is never called', async (decision) => {
    reads.getVariationByToken.mockResolvedValue({ contractSource: 'boq' });
    expect(await respondToVariation('v-raw', decision, 'Hesham')).toEqual({ ok: false, error: 'moved' });
    expect(reads.respondToVariationByToken).not.toHaveBeenCalled();
  });

  it('a proposal order: ONE respond, with the capped name and the provenance', async () => {
    reads.getVariationByToken.mockResolvedValue({ contractSource: 'proposal' });
    expect(await respondToVariation('v-raw', 'approve', ` ${'a'.repeat(200)} `)).toEqual({ ok: true });
    expect(reads.respondToVariationByToken).toHaveBeenCalledTimes(1);
    expect(reads.respondToVariationByToken).toHaveBeenCalledWith('v-raw', { decision: 'approve', actorName: 'a'.repeat(120), ip: '9.9.9.9', userAgent: 'probe/1' });
  });

  it('no document: goes on to the SDF, whose code is the answer', async () => {
    reads.getVariationByToken.mockResolvedValue(null);
    reads.respondToVariationByToken.mockResolvedValue({ ok: false, error: 'token_invalid' });
    expect(await respondToVariation('v-raw', 'reject')).toEqual({ ok: false, error: 'token_invalid' });
    expect(reads.respondToVariationByToken).toHaveBeenCalledWith('v-raw', { decision: 'reject', actorName: null, ip: '9.9.9.9', userAgent: 'probe/1' });
  });

  it('a read that throws: a failure with its reference, never a throw and never a write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.getVariationByToken.mockRejectedValue(new Error('down'));
    expect(await respondToVariation('v-raw', 'approve')).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(reads.respondToVariationByToken).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
