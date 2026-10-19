import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingRateLimit } from '@/test/fake-rate-limit-env';
import { STUDIO_READ_CEILING, STUDIO_SEARCH_CEILING } from '@/test/wrangler-rate-limits';

// The studio's per-member read brake on the Cloudflare Rate Limiting binding.
// The runtime probes are replaced so the on-platform path runs in Node.
vi.mock('server-only', () => ({}));
const isCloudflareRuntime = vi.fn(() => true);
const cfEnv = vi.fn(() => ({}) as Record<string, unknown>);
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime, cfEnv }));

const { studioReadRefusal, studioReadVerdict } = await import('./studio-read-rate-limit');

const OWNER = { orgId: 'org-1', userId: 'user-1', role: 'owner' as const };
const OTHER_MEMBER = { ...OWNER, userId: 'user-2' };
const OTHER_WORKSPACE = { ...OWNER, orgId: 'org-2' };

beforeEach(() => {
  isCloudflareRuntime.mockReturnValue(true);
  cfEnv.mockReturnValue({
    STUDIO_READ_RATE_LIMITER: countingRateLimit(STUDIO_READ_CEILING),
    STUDIO_SEARCH_RATE_LIMITER: countingRateLimit(STUDIO_SEARCH_CEILING),
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('studioReadVerdict', () => {
  it('allows the ceiling per member, surface and workspace, then refuses that bucket only', async () => {
    for (let call = 0; call < STUDIO_READ_CEILING; call += 1) expect(await studioReadVerdict(OWNER, 'rescue_ledger')).toBe('allowed');
    expect(await studioReadVerdict(OWNER, 'rescue_ledger')).toBe('refused');
    expect(await studioReadVerdict(OWNER, 'price_book_picker')).toBe('allowed');
    expect(await studioReadVerdict(OTHER_MEMBER, 'rescue_ledger')).toBe('allowed');
    expect(await studioReadVerdict(OTHER_WORKSPACE, 'rescue_ledger')).toBe('allowed');
  });

  it('gives each picker the search budget, its own bucket per member', async () => {
    for (let call = 0; call < STUDIO_SEARCH_CEILING; call += 1) expect(await studioReadVerdict(OWNER, 'price_book_picker')).toBe('allowed');
    expect(await studioReadVerdict(OWNER, 'price_book_picker')).toBe('refused');
    expect(await studioReadVerdict(OWNER, 'contract_line_search')).toBe('allowed');
    expect(await studioReadVerdict(OWNER, 'rescue_ledger')).toBe('allowed');
  });

  it('refuses a picker when only the search binding is missing on Cloudflare', async () => {
    cfEnv.mockReturnValue({ STUDIO_READ_RATE_LIMITER: countingRateLimit(STUDIO_READ_CEILING) });
    expect(await studioReadVerdict(OWNER, 'price_book_picker')).toBe('misdeployed');
    expect(await studioReadVerdict(OWNER, 'rescue_ledger')).toBe('allowed');
  });

  it('logs a refusal by binding and surface, never the key', async () => {
    for (let call = 0; call <= STUDIO_SEARCH_CEILING; call += 1) await studioReadVerdict(OWNER, 'contract_line_search');
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ['studio read rate limit refused:', { binding: 'STUDIO_SEARCH_RATE_LIMITER', surface: 'contract_line_search' }],
    ]);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('user-1');
  });

  it('is misdeployed, not unlimited, when the binding is missing on Cloudflare', async () => {
    cfEnv.mockReturnValue({});
    expect(await studioReadVerdict(OWNER, 'rescue_ledger')).toBe('misdeployed');
  });

  it('allows everything off the platform', async () => {
    isCloudflareRuntime.mockReturnValue(false);
    cfEnv.mockReturnValue({});
    expect(await studioReadVerdict(OWNER, 'rescue_ledger')).toBe('allowed');
  });
});

describe('studioReadRefusal', () => {
  it('is null while allowed, rate_limited past the budget, and generic with a reference when misdeployed', async () => {
    expect(await studioReadRefusal(OWNER, 'price_book_picker')).toBeNull();
    for (let call = 1; call < STUDIO_SEARCH_CEILING; call += 1) await studioReadRefusal(OWNER, 'price_book_picker');
    expect(await studioReadRefusal(OWNER, 'price_book_picker')).toEqual({ ok: false, error: 'rate_limited' });
    cfEnv.mockReturnValue({});
    expect(await studioReadRefusal(OWNER, 'price_book_picker')).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
  });
});
