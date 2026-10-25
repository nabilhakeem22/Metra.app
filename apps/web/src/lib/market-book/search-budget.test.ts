import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingRateLimit } from '@/test/fake-rate-limit-env';
import { STUDIO_SEARCH_CEILING } from '@/test/wrangler-rate-limits';

// /market-book's searches on the member's search budget (S1). The runtime
// probes are replaced so the on-platform path runs in Node.
vi.mock('server-only', () => ({}));
const isCloudflareRuntime = vi.fn(() => true);
const cfEnv = vi.fn(() => ({}) as Record<string, unknown>);
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime, cfEnv }));

const { marketSearchRefusal } = await import('./search-budget');
const { studioReadVerdict } = await import('@/lib/cf/studio-read-rate-limit');

const OWNER = { orgId: 'org-1', userId: 'user-1', role: 'owner' as const };
const SEARCH = { categoryKey: null, query: 'glass', page: 1 };
const CATEGORY = { categoryKey: 'finishing.glass', query: '', page: 1 };

beforeEach(() => {
  isCloudflareRuntime.mockReturnValue(true);
  cfEnv.mockReturnValue({ STUDIO_SEARCH_RATE_LIMITER: countingRateLimit(STUDIO_SEARCH_CEILING) });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('marketSearchRefusal', () => {
  it('lets the ceiling of searches through, then refuses as rate_limited; a category page is never charged', async () => {
    for (let call = 0; call < STUDIO_SEARCH_CEILING; call += 1) expect(await marketSearchRefusal(OWNER, SEARCH)).toBeNull();
    expect(await marketSearchRefusal(OWNER, SEARCH)).toEqual({ ok: false, error: 'rate_limited' });
    expect(await marketSearchRefusal(OWNER, CATEGORY)).toBeNull();
  });

  it('spends its own bucket, never a picker\'s', async () => {
    for (let call = 0; call <= STUDIO_SEARCH_CEILING; call += 1) await marketSearchRefusal(OWNER, SEARCH);
    expect(await studioReadVerdict(OWNER, 'price_book_picker')).toBe('allowed');
  });

  it('refuses, with a logged reference, when the binding is missing on Cloudflare', async () => {
    cfEnv.mockReturnValue({});
    expect(await marketSearchRefusal(OWNER, SEARCH)).toEqual({ ok: false, error: 'generic', reference: expect.any(String) });
    expect(vi.mocked(console.error).mock.calls.map(([label]) => label)).toContain('market_search read limiter missing');
  });
});
