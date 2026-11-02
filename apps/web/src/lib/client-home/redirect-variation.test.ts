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
import { REDIRECT_LOOKUP_WAIT_MS } from './redirect';
import { variationLinkLanding } from './redirect-variation';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const V_RAW = 'variation-raw-token';
let logged: string;

const variationOf = (over: Partial<PublicVariation> = {}) =>
  ({
    id: ORDER,
    contract_number: 4,
    status: 'issued',
    contractActive: true,
    contractSource: 'boq',
    share_expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  }) as PublicVariation;

const homePathOf = async (...asked: Parameters<typeof variationLinkLanding>) => (await variationLinkLanding(...asked)).homePath;

function liveHome() {
  const home = mintDeliveryLinkToken(ENGAGEMENT);
  return { home, target: { engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce, focus_id: ORDER } };
}

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

describe('variationLinkLanding, its home path', () => {
  it('the home path in the asked locale, on the order, from the hash of the trimmed token; the target asked by kind', async () => {
    const { home, target } = liveHome();
    sdf.readSdfJson
      .mockResolvedValueOnce({ ...target, focus_id: ORDER.toUpperCase() })
      .mockResolvedValueOnce(homePayload('decide_change_order'));
    expect(await homePathOf(` ${V_RAW} `, variationOf(), 'ar-EG')).toBe(`/ar-EG/d/${home.raw}?tab=execution&focus=variation:${ORDER}`);
    const [asked] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }];
    expect(asked.queryChunks).toContain('variation');
    expect(asked.queryChunks).toContain(hashShareToken(V_RAW));
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[1][0])).toContain('app_home_by_token');
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
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
    expect(await homePathOf(V_RAW, variation, 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('a blank token is null with no round trip', async () => {
    expect(await homePathOf('  ', variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('no target is null after one read; a home that does not show the order is null after two', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await homePathOf(V_RAW, variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    sdf.readSdfJson.mockReset().mockResolvedValueOnce(liveHome().target).mockResolvedValueOnce(homePayload('decide_change_order'));
    expect(await homePathOf(V_RAW, variationOf({ contract_number: 5 }), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
    expect(logged).toBe('');
  });

  it('a target with no usable focus is the shape error: one constant line, null', async () => {
    sdf.readSdfJson.mockResolvedValue({ ...liveHome().target, focus_id: 'nope' });
    expect(await homePathOf(V_RAW, variationOf(), 'en')).toBeNull();
    expect(logged).toBe(JSON.stringify(['documentHomeRedirect: unexpected target shape']));
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
  });

  it('a home link that cannot be re-derived is null, and the home is not asked: no nonce, no secret', async () => {
    const { home, target } = liveHome();
    sdf.readSdfJson.mockResolvedValue({ ...target, token_nonce: null });
    expect(await homePathOf(V_RAW, variationOf(), 'en')).toBeNull();
    delete process.env.SHARE_LINK_SECRET;
    sdf.readSdfJson.mockResolvedValue(target);
    expect(await homePathOf(V_RAW, variationOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
    expect(logged).not.toContain(home.raw);
  });
});

describe('an order waiting for its contract to be signed (the lead ruling after the H7 build)', () => {
  it('the home stands on its contract, unsigned: no path, it waits; two reads and no more', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(liveHome().target).mockResolvedValueOnce(homePayload('sign_contract'));
    expect(await variationLinkLanding(V_RAW, variationOf(), 'en')).toEqual({ homePath: null, waitsForSignature: true });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
  });

  it('with the signing window closed it still waits for the signature', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(liveHome().target).mockResolvedValueOnce(homePayload('signing_closed'));
    expect(await variationLinkLanding(V_RAW, variationOf(), 'en')).toEqual({ homePath: null, waitsForSignature: true });
  });

  it('a signed contract, no home, another contract and a failed read do not wait', async () => {
    const { home, target } = liveHome();
    sdf.readSdfJson.mockResolvedValueOnce(target).mockResolvedValueOnce(homePayload('decide_change_order'));
    expect(await variationLinkLanding(V_RAW, variationOf(), 'en')).toEqual({
      homePath: `/en/d/${home.raw}?tab=execution&focus=variation:${ORDER}`,
      waitsForSignature: false,
    });
    sdf.readSdfJson.mockReset().mockResolvedValueOnce(null);
    expect(await variationLinkLanding(V_RAW, variationOf(), 'en')).toEqual({ homePath: null, waitsForSignature: false });
    sdf.readSdfJson.mockReset().mockResolvedValueOnce(liveHome().target).mockResolvedValueOnce(homePayload('sign_contract'));
    expect(await variationLinkLanding(V_RAW, variationOf({ contract_number: 5 }), 'en')).toEqual({ homePath: null, waitsForSignature: false });
    sdf.readSdfJson.mockReset().mockResolvedValueOnce(liveHome().target).mockRejectedValueOnce(new Error('down'));
    expect(await variationLinkLanding(V_RAW, variationOf(), 'en')).toEqual({ homePath: null, waitsForSignature: false });
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
    expect(await homePathOf(V_RAW, variationOf(), 'en')).toBeNull();
    expect(logged).toContain('documentHomeRedirect: lookup failed');
    expect(logged).toContain('"kind":"variation"');
    expect(logged).toContain('"step":"target"');
    expect(logged).toContain('57014');
    expect(logged).not.toContain(hashShareToken(V_RAW));
    expect(logged).not.toContain(V_RAW);
    logged = '';
    // The home read logs its own failure, redacted, and answers not shown.
    sdf.readSdfJson.mockResolvedValueOnce(liveHome().target).mockRejectedValueOnce(failedQuery());
    expect(await homePathOf(V_RAW, variationOf(), 'en')).toBeNull();
    expect(logged).toContain('client home read failed');
    expect(logged).not.toContain(hashShareToken(V_RAW));
  });

  it('a stalled read: null at the budget of 3.5 s, with DbDeadlineError in the line', async () => {
    vi.useFakeTimers();
    sdf.readSdfJson.mockReturnValue(new Promise(() => {}));
    const answer = homePathOf(V_RAW, variationOf(), 'en');
    await vi.advanceTimersByTimeAsync(REDIRECT_LOOKUP_WAIT_MS - 1);
    expect(logged).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBeNull();
    expect(logged).toContain('DbDeadlineError');
    expect(REDIRECT_LOOKUP_WAIT_MS).toBe(3_500);
  });
});
