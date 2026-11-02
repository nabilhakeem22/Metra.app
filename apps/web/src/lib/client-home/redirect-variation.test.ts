import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.2: where an old /v link sends its holder. As /c after H6.3: only a BOQ
// contract's order open for the client's decision, in its window, asks at all;
// then the home target, the link re-derived, and that the home lists THIS order.
// A read that fails or stalls: the link's own document, one redacted line.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { mintDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { hashShareToken } from '@/lib/share/token';
import { homePayload } from '@/test/client-home-payloads';
import type { PublicVariation } from '@/lib/variations/public-types';
import { REDIRECT_LOOKUP_WAIT_MS, variationHomeRedirect } from './redirect';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const V_RAW = 'variation-raw-token';
let logged: string;

const variationOf = (over: Partial<PublicVariation> = {}) =>
  ({
    id: ORDER,
    status: 'issued',
    contractActive: true,
    contractSource: 'boq',
    share_expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  }) as PublicVariation;

function liveHome() {
  const home = mintDeliveryLinkToken(ENGAGEMENT);
  return { home, target: { engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce, focus_id: ORDER } };
}

const listing = (...ids: string[]) => ({ open: ids.map((id) => ({ id, net_delta: '1', lines: [] })), expired: [], decided: [] });

beforeEach(() => {
  process.env.SHARE_LINK_SECRET = 'r'.repeat(48);
  sdf.readSdfJson.mockReset();
  logged = '';
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged += JSON.stringify(args);
  });
});

afterEach(() => {
  delete process.env.SHARE_LINK_SECRET;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('variationHomeRedirect', () => {
  it('the home path in the asked locale, on the order, from the hash of the trimmed token; the target asked by kind', async () => {
    const { home, target } = liveHome();
    sdf.readSdfJson
      .mockResolvedValueOnce({ ...target, focus_id: ORDER.toUpperCase() })
      .mockResolvedValueOnce(listing(ORDER))
      .mockResolvedValueOnce(homePayload('decide_change_order'));
    expect(await variationHomeRedirect(` ${V_RAW} `, variationOf(), 'ar-EG')).toBe(`/ar-EG/d/${home.raw}?tab=execution&focus=variation:${ORDER}`);
    const [asked] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }];
    expect(asked.queryChunks).toContain('variation');
    expect(asked.queryChunks).toContain(hashShareToken(V_RAW));
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[1][0])).toContain('app_home_variations_by_token');
    expect(logged).toBe('');
  });

  it.each<[string, PublicVariation | null]>([
    ['no order', null],
    ['a proposal contract order', variationOf({ contractSource: 'proposal' })],
    ['an approved order', variationOf({ status: 'approved' })],
    ['a rejected order', variationOf({ status: 'rejected' })],
    ['an order of a terminated contract', variationOf({ contractActive: false })],
    ['a window that has closed', variationOf({ share_expires_at: new Date(Date.now() - 1_000).toISOString() })],
  ])('%s is null with no round trip', async (_case, variation) => {
    expect(await variationHomeRedirect(V_RAW, variation, 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('a blank token is null with no round trip', async () => {
    expect(await variationHomeRedirect('  ', variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('no target is null after one read; a home that does not list the order is null after two', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    sdf.readSdfJson.mockReset().mockResolvedValueOnce(liveHome().target).mockResolvedValueOnce(listing(OTHER));
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
    expect(logged).toBe('');
  });

  it('a target with no usable focus is the shape error: one constant line, null', async () => {
    sdf.readSdfJson.mockResolvedValue({ ...liveHome().target, focus_id: 'nope' });
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    expect(logged).toBe(JSON.stringify(['documentHomeRedirect: unexpected target shape']));
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
  });

  it('a home link that cannot be re-derived is null, and the home is not asked: no nonce, no secret', async () => {
    const { home, target } = liveHome();
    sdf.readSdfJson.mockResolvedValue({ ...target, token_nonce: null });
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    delete process.env.SHARE_LINK_SECRET;
    sdf.readSdfJson.mockResolvedValue(target);
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
    expect(logged).not.toContain(home.raw);
  });
});

describe('a lookup that fails or stalls is the link own document', () => {
  const failedQuery = () =>
    Object.assign(new Error(`Failed query: select params: ${hashShareToken(V_RAW)}`), {
      params: [hashShareToken(V_RAW)],
      cause: Object.assign(new Error('canceling statement'), { name: 'PostgresError', code: '57014' }),
    });

  it('a failed read: null, one redacted line naming the kind and the step', async () => {
    sdf.readSdfJson.mockRejectedValueOnce(failedQuery());
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    expect(logged).toContain('documentHomeRedirect: lookup failed');
    expect(logged).toContain('"kind":"variation"');
    expect(logged).toContain('"step":"target"');
    expect(logged).toContain('57014');
    expect(logged).not.toContain(hashShareToken(V_RAW));
    expect(logged).not.toContain(V_RAW);
    logged = '';
    sdf.readSdfJson.mockResolvedValueOnce(liveHome().target).mockRejectedValueOnce(failedQuery());
    expect(await variationHomeRedirect(V_RAW, variationOf(), 'en')).toBeNull();
    expect(logged).toContain('"step":"home_shows"');
  });

  it('a stalled read: null at the budget of 3.5 s, with DbDeadlineError in the line', async () => {
    vi.useFakeTimers();
    sdf.readSdfJson.mockReturnValue(new Promise(() => {}));
    const answer = variationHomeRedirect(V_RAW, variationOf(), 'en');
    await vi.advanceTimersByTimeAsync(REDIRECT_LOOKUP_WAIT_MS - 1);
    expect(logged).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBeNull();
    expect(logged).toContain('DbDeadlineError');
    expect(REDIRECT_LOOKUP_WAIT_MS).toBe(3_500);
  });
});
