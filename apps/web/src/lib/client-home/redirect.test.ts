import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3: where an old /c link sends its holder. Only a BOQ contract awaiting its
// signature, in its window, asks at all (S1). Then the home target, the home
// link re-derived, and that the home shows THIS contract (F1). A target this
// build cannot read, or a link it cannot re-derive: /c renders its own document.
// A read that fails or stalls: redirect-failure.test.ts.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import type { PublicContract } from '@/lib/contracts/public-types';
import { mintDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { hashShareToken } from '@/lib/share/token';
import { contractHomeRedirect } from './redirect';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_RAW = 'contract-raw-token';
const SECTIONS_PAGE = { offset: 7, section_count: 7, sections: [] };
let logged: string;

const contractOf = (over: Partial<PublicContract> = {}) =>
  ({
    id: CONTRACT_ID,
    source: 'boq',
    status: 'issued',
    share_expires_at: new Date(Date.now() + 60_000).toISOString(),
    section_count: 7,
    ...over,
  }) as PublicContract;

beforeEach(() => {
  process.env.SHARE_LINK_SECRET = 'r'.repeat(48);
  sdf.readSdfJson.mockReset();
  logged = '';
  for (const method of ['error', 'warn', 'log'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged += JSON.stringify(args);
    });
  }
});

afterEach(() => {
  delete process.env.SHARE_LINK_SECRET;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const boundValues = () => JSON.stringify(sdf.readSdfJson.mock.calls.map(([query]) => (query as { queryChunks: unknown[] }).queryChunks));

/** The target answered, then the home's bound sections read. */
function homeAnswers(target: unknown, shown: unknown = SECTIONS_PAGE) {
  sdf.readSdfJson.mockResolvedValueOnce(target).mockResolvedValueOnce(shown);
}

function liveHome() {
  const home = mintDeliveryLinkToken(ENGAGEMENT);
  return { home, target: { engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce, focus_id: CONTRACT_ID } };
}

describe('contractHomeRedirect', () => {
  it('answers the home path in the asked locale, from the hash of the trimmed token', async () => {
    const { home, target } = liveHome();
    homeAnswers(target);
    expect(await contractHomeRedirect(` ${CONTRACT_RAW} `, contractOf(), 'ar-EG')).toBe(`/ar-EG/d/${home.raw}?tab=execution&focus=contract`);
    homeAnswers(target);
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBe(`/en/d/${home.raw}?tab=execution&focus=contract`);
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(4);
    expect(boundValues()).toContain(hashShareToken(CONTRACT_RAW));
    expect(boundValues()).not.toContain(CONTRACT_RAW + '"');
    expect(logged).toBe('');
  });

  it('a window with no end date still redirects, as the SQL reads it', async () => {
    const { home, target } = liveHome();
    homeAnswers(target);
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf({ share_expires_at: null }), 'en')).toBe(`/en/d/${home.raw}?tab=execution&focus=contract`);
  });

  it('asks the home about this contract, from past its last section', async () => {
    homeAnswers(liveHome().target);
    await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en');
    const [sections] = sdf.readSdfJson.mock.calls[1] as [{ queryChunks: unknown[] }];
    expect(JSON.stringify(sections.queryChunks)).toContain('app_home_contract_sections_by_token');
    expect(sections.queryChunks).toContain(CONTRACT_ID);
    expect(sections.queryChunks).toContain(7);
  });

  it.each<[string, PublicContract | null]>([
    ['no contract', null],
    ['a proposal contract', contractOf({ source: 'proposal' })],
    ['a signed contract', contractOf({ status: 'signed' })],
    ['a window that has closed', contractOf({ share_expires_at: new Date(Date.now() - 1_000).toISOString() })],
  ])('%s is null with no round trip (S1)', async (_case, contract) => {
    expect(await contractHomeRedirect(CONTRACT_RAW, contract, 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it.each(['', '   ', '\n'])('a blank token (%j) is null with no round trip', async (blank) => {
    expect(await contractHomeRedirect(blank, contractOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('no target is null, and the home is not asked', async () => {
    sdf.readSdfJson.mockResolvedValue(null);
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
  });

  it('a home that shows another contract is null (F1)', async () => {
    homeAnswers(liveHome().target, null);
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    expect(logged).toBe('');
  });

  it.each([
    ['a non-object', 'text'],
    ['a non-uuid id', { engagement_id: 'nope', token_hash: 'h', token_nonce: 'n' }],
    ['no hash', { engagement_id: ENGAGEMENT, token_hash: null, token_nonce: 'n' }],
    ['a numeric nonce', { engagement_id: ENGAGEMENT, token_hash: 'h', token_nonce: 7 }],
  ])('a target of an unexpected shape (%s) is null, with one constant log line', async (_name, row) => {
    sdf.readSdfJson.mockResolvedValue(row);
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    expect(logged).toBe(JSON.stringify(['contractHomeRedirect: unexpected target shape']));
  });

  it('a home link that cannot be re-derived is null: no nonce, no secret, a hash that does not match', async () => {
    const home = mintDeliveryLinkToken(ENGAGEMENT);
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: null });
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: 'f'.repeat(64), token_nonce: home.nonce });
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    delete process.env.SHARE_LINK_SECRET;
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce });
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    expect(logged).not.toContain(home.raw);
    expect(logged).not.toContain(CONTRACT_RAW);
  });
});
