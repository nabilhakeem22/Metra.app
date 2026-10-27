import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 (AC3, unit part): where an old /c link sends its holder. One token
// read, one re-derive: a blank token never reaches the database, and a
// target this build cannot read, or a home link it cannot re-derive, renders
// /c as before. Only the token's hash is bound; no log line names a token.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { mintDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { hashShareToken } from '@/lib/share/token';
import { contractHomeRedirect } from './redirect';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const CONTRACT_RAW = 'contract-raw-token';
let logged: string;

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
  vi.restoreAllMocks();
});

const boundValues = () => JSON.stringify(sdf.readSdfJson.mock.calls.map(([query]) => (query as { queryChunks: unknown[] }).queryChunks));

describe('contractHomeRedirect', () => {
  it('answers the home path in the asked locale, from the hash of the trimmed token', async () => {
    const home = mintDeliveryLinkToken(ENGAGEMENT);
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce, focus_id: 'x' });
    expect(await contractHomeRedirect(` ${CONTRACT_RAW} `, 'ar-EG')).toBe(`/ar-EG/d/${home.raw}?tab=execution&focus=contract`);
    expect(await contractHomeRedirect(CONTRACT_RAW, 'en')).toBe(`/en/d/${home.raw}?tab=execution&focus=contract`);
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
    expect(boundValues()).toContain(hashShareToken(CONTRACT_RAW));
    expect(boundValues()).not.toContain(CONTRACT_RAW + '"');
  });

  it.each(['', '   ', '\n'])('a blank token (%j) is null with no round trip', async (blank) => {
    expect(await contractHomeRedirect(blank, 'en')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('no target is null', async () => {
    sdf.readSdfJson.mockResolvedValue(null);
    expect(await contractHomeRedirect(CONTRACT_RAW, 'en')).toBeNull();
  });

  it.each([
    ['a non-object', 'text'],
    ['a non-uuid id', { engagement_id: 'nope', token_hash: 'h', token_nonce: 'n' }],
    ['no hash', { engagement_id: ENGAGEMENT, token_hash: null, token_nonce: 'n' }],
    ['a numeric nonce', { engagement_id: ENGAGEMENT, token_hash: 'h', token_nonce: 7 }],
  ])('a target of an unexpected shape (%s) is null, with one constant log line', async (_name, row) => {
    sdf.readSdfJson.mockResolvedValue(row);
    expect(await contractHomeRedirect(CONTRACT_RAW, 'en')).toBeNull();
    expect(logged).toBe(JSON.stringify(['contractHomeRedirect: unexpected target shape']));
  });

  it('a home link that cannot be re-derived is null: no nonce, no secret, a hash that does not match', async () => {
    const home = mintDeliveryLinkToken(ENGAGEMENT);
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: null });
    expect(await contractHomeRedirect(CONTRACT_RAW, 'en')).toBeNull();
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: 'f'.repeat(64), token_nonce: home.nonce });
    expect(await contractHomeRedirect(CONTRACT_RAW, 'en')).toBeNull();
    delete process.env.SHARE_LINK_SECRET;
    sdf.readSdfJson.mockResolvedValue({ engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce });
    expect(await contractHomeRedirect(CONTRACT_RAW, 'en')).toBeNull();
    expect(logged).not.toContain(home.raw);
    expect(logged).not.toContain(CONTRACT_RAW);
  });

  it('a throw from the read propagates: never a misleading null', async () => {
    sdf.readSdfJson.mockRejectedValue(new Error('db down'));
    await expect(contractHomeRedirect(CONTRACT_RAW, 'en')).rejects.toThrow('db down');
  });
});
