import { beforeEach, describe, expect, it, vi } from 'vitest';

// H7.1: deciding a change order and reading its lines are server actions that
// never throw to the client. The link's brake comes first (nothing read or
// written past it); then ONE act, or ONE read.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
const brake = vi.hoisted(() => ({ portalActAllowed: vi.fn(async () => true), portalReadAllowed: vi.fn(async () => true) }));
vi.mock('@/lib/share/portal-rate-limit', () => brake);
const acts = vi.hoisted(() => ({ decideVariationWithCodeByToken: vi.fn() }));
vi.mock('@/lib/client-home/code-acts', () => acts);
const reads = vi.hoisted(() => ({ getOpenChangeOrderLines: vi.fn() }));
vi.mock('@/lib/client-home/variations', () => reads);

const { decideVariationInHome, loadChangeOrderLines } = await import('./variation-actions');

const TOKEN = 'portal-link-token';
const ORDER = '22222222-2222-4222-8222-222222222222';
const DECIDE = { variationId: ORDER, decision: 'approve' as const, name: 'هشام عادل', code: '042917' };
const LEAKY = Object.assign(new Error('Failed query: select public.app_home_variation_respond_by_token params: SECRET-HASH,CODE-HASH,name,9.9.9.9'), {
  cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', severity: 'ERROR' }),
});

beforeEach(() => {
  brake.portalActAllowed.mockReset().mockResolvedValue(true);
  brake.portalReadAllowed.mockReset().mockResolvedValue(true);
  acts.decideVariationWithCodeByToken.mockReset().mockResolvedValue({ ok: true, already: false });
  reads.getOpenChangeOrderLines.mockReset();
});

describe('decideVariationInHome', () => {
  it('passes the order, the decision, the name and the code with the provenance, and answers as the act did', async () => {
    expect(await decideVariationInHome(TOKEN, DECIDE)).toEqual({ ok: true, already: false });
    expect(acts.decideVariationWithCodeByToken).toHaveBeenCalledWith(TOKEN, { ...DECIDE, ip: '9.9.9.9', userAgent: 'probe/1' });
    acts.decideVariationWithCodeByToken.mockResolvedValue({ ok: false, error: 'name_required' });
    expect(await decideVariationInHome(TOKEN, DECIDE)).toEqual({ ok: false, error: 'name_required' });
  });

  it('past the link brake: too_many for the link minute, and the act is never run', async () => {
    brake.portalActAllowed.mockResolvedValueOnce(false);
    expect(await decideVariationInHome(TOKEN, DECIDE)).toEqual({ ok: false, error: 'too_many', retryAfterSeconds: 60, limit: 'link_minute' });
    expect(acts.decideVariationWithCodeByToken).not.toHaveBeenCalled();
  });

  it('a direct call with no input reaches the act with nothing, which refuses it, never a throw', async () => {
    acts.decideVariationWithCodeByToken.mockResolvedValue({ ok: false, error: 'wrong_target' });
    expect(await decideVariationInHome(TOKEN, undefined as never)).toEqual({ ok: false, error: 'wrong_target' });
    expect(acts.decideVariationWithCodeByToken).toHaveBeenCalledWith(TOKEN, { variationId: undefined, decision: undefined, name: undefined, code: undefined, ip: '9.9.9.9', userAgent: 'probe/1' });
  });

  it('a write that gave up on a lock past the act: uncertain, one log line with none of the query parameters', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    acts.decideVariationWithCodeByToken.mockRejectedValue(LEAKY);
    expect(await decideVariationInHome(TOKEN, DECIDE)).toEqual({ ok: false, error: 'uncertain' });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/SECRET-HASH|CODE-HASH|9\.9\.9\.9/);
    logged.mockRestore();
  });

  it('a failure underneath that is no lost write: generic with its reference', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    acts.decideVariationWithCodeByToken.mockRejectedValue(new Error('boom'));
    expect(await decideVariationInHome(TOKEN, DECIDE)).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    logged.mockRestore();
  });
});

describe('loadChangeOrderLines', () => {
  it('the lines; gone, uniformly, when the home no longer shows the order', async () => {
    reads.getOpenChangeOrderLines.mockResolvedValueOnce([{ id: 'l-1' }]).mockResolvedValueOnce(null);
    expect(await loadChangeOrderLines(TOKEN, ORDER)).toEqual({ ok: true, lines: [{ id: 'l-1' }] });
    expect(await loadChangeOrderLines(TOKEN, ORDER)).toEqual({ ok: false, error: 'gone' });
    expect(reads.getOpenChangeOrderLines).toHaveBeenCalledWith(TOKEN, ORDER);
  });

  it('past the read brake: too_many, and nothing is read', async () => {
    brake.portalReadAllowed.mockResolvedValueOnce(false);
    expect(await loadChangeOrderLines(TOKEN, ORDER)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.getOpenChangeOrderLines).not.toHaveBeenCalled();
  });

  it('a failure underneath: generic with its reference, never a throw', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads.getOpenChangeOrderLines.mockRejectedValue(new Error('boom'));
    expect(await loadChangeOrderLines(TOKEN, ORDER)).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
    logged.mockRestore();
  });
});
