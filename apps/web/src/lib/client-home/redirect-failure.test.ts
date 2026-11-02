import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 (reliability M1, L5; security S3): the /c page's lookup of the client
// home has its own short budget. A read that fails or stalls renders the link's
// own document, never an error page, with one redacted line naming the step.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import type { PublicContract } from '@/lib/contracts/public-types';
import { mintDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { hashShareToken } from '@/lib/share/token';
import { contractHomeRedirect, REDIRECT_LOOKUP_WAIT_MS } from './redirect';

const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';
const CONTRACT_RAW = 'contract-raw-token';
let logged: string;

const contractOf = () =>
  ({
    id: '22222222-2222-4222-8222-222222222222',
    source: 'boq',
    status: 'issued',
    share_expires_at: new Date(Date.now() + 60_000).toISOString(),
    section_count: 7,
  }) as PublicContract;

function liveHomeTarget() {
  const home = mintDeliveryLinkToken(ENGAGEMENT);
  return { engagement_id: ENGAGEMENT, token_hash: home.hash, token_nonce: home.nonce };
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

describe('a lookup that fails or stalls is the link own document', () => {
  /** What drizzle throws: the query and the token hash on the wrapper, the driver error as its cause. */
  const failedQuery = () =>
    Object.assign(new Error(`Failed query: select app_client_home_target_by_token params: ${hashShareToken(CONTRACT_RAW)}`), {
      query: 'select public.app_client_home_target_by_token',
      params: [hashShareToken(CONTRACT_RAW)],
      cause: Object.assign(new Error('canceling statement'), { name: 'PostgresError', code: '57014' }),
    });

  it('a failed target read: null, one redacted line naming the step, no token or hash (S3, L5)', async () => {
    sdf.readSdfJson.mockRejectedValue(failedQuery());
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    expect(logged).toContain('documentHomeRedirect: lookup failed');
    expect(logged).toContain('"step":"target"');
    expect(logged).toContain('57014');
    expect(logged).not.toContain(hashShareToken(CONTRACT_RAW));
    expect(logged).not.toContain(CONTRACT_RAW);
  });

  it('a failed check of the current contract: null, naming that step', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(liveHomeTarget()).mockRejectedValueOnce(failedQuery());
    expect(await contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en')).toBeNull();
    expect(logged).toContain('"step":"home_shows"');
  });

  it('a stalled read: null at the budget, not the database deadline, with DbDeadlineError in the line', async () => {
    vi.useFakeTimers();
    sdf.readSdfJson.mockReturnValue(new Promise(() => {}));
    const answer = contractHomeRedirect(CONTRACT_RAW, contractOf(), 'en');
    await vi.advanceTimersByTimeAsync(REDIRECT_LOOKUP_WAIT_MS - 1);
    expect(logged).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBeNull();
    expect(logged).toContain('DbDeadlineError');
    expect(logged).toContain('"step":"target"');
    expect(REDIRECT_LOOKUP_WAIT_MS).toBeGreaterThanOrEqual(3_000);
    expect(REDIRECT_LOOKUP_WAIT_MS).toBeLessThanOrEqual(4_000);
  });
});
