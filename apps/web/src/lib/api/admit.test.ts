import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberRole } from '@metra/db';
import type { ApiPrincipal } from '@/lib/api-keys/resolve';

// Admission is server-only and so is everything behind it. The key resolver is
// replaced (its SQL is proven in tests/actions/api-isolation.dbtest.ts) and both
// budgets are injected, so what is proven here is the ORDER of the refusals and
// which of them spend a budget.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => false, cfEnv: () => ({}) }));
const resolveApiKey = vi.fn<(rawKey: string | null) => Promise<ApiPrincipal | null>>();
vi.mock('@/lib/api-keys/resolve', () => ({
  resolveApiKey: (rawKey: string | null) => resolveApiKey(rawKey),
}));

const { admitApiCaller } = await import('./admit');

const RAW_KEY = `mtk_${'A'.repeat(43)}`;
const READ_PROJECTS = { capability: 'projects', action: 'read' } as const;
const READ_PRICE_BOOK = { capability: 'price_book', action: 'read' } as const;

const preAuthRateLimiter = vi.fn(async (_req: Request) => ({ allowed: true, retryAfterSeconds: 0 }));
const rateLimiter = vi.fn(async (_keyId: string) => ({ allowed: true, retryAfterSeconds: 0 }));
const limiters = { preAuthRateLimiter, rateLimiter };

function principalWith(role: MemberRole): ApiPrincipal {
  const identity = { orgId: 'org-1', userId: 'user-1', role };
  return { ...identity, keyId: 'key-1', toOrgContext: () => identity };
}

function request(rawKey: string | null = RAW_KEY): Request {
  return new Request('https://api.metra.app/v1/projects', {
    headers: rawKey ? { authorization: `Bearer ${rawKey}` } : {},
  });
}

async function problemOf(admitted: ApiPrincipal | Response): Promise<{ status: number; type: string; detail?: string }> {
  if (!(admitted instanceof Response)) throw new Error('expected a refusal, got a principal');
  expect(admitted.headers.get('content-type')).toBe('application/problem+json');
  return (await admitted.json()) as { status: number; type: string; detail?: string };
}

beforeEach(() => {
  resolveApiKey.mockReset();
  preAuthRateLimiter.mockClear();
  rateLimiter.mockClear();
});

describe('a key whose creator holds the client role (AC4)', () => {
  it('is refused 403 on projects:read, which the matrix grants client, and spends no per-key budget', async () => {
    resolveApiKey.mockResolvedValue(principalWith('client'));
    const problem = await problemOf(await admitApiCaller(request(), { ...READ_PROJECTS, ...limiters }));
    expect(problem.status).toBe(403);
    expect(problem.type).toContain('/problems/forbidden');
    expect(problem.detail).toBe('The role behind this API key may not use the API.');
    expect(rateLimiter).not.toHaveBeenCalled();
  });

  it('is refused the same way on a capability client lacks', async () => {
    resolveApiKey.mockResolvedValue(principalWith('client'));
    const problem = await problemOf(await admitApiCaller(request(), { ...READ_PRICE_BOOK, ...limiters }));
    expect(problem.detail).toBe('The role behind this API key may not use the API.');
    expect(rateLimiter).not.toHaveBeenCalled();
  });
});

describe('a key whose creator holds an internal role (AC5)', () => {
  it('admits a viewer on projects:read, charging that key its budget once', async () => {
    const viewer = principalWith('viewer');
    resolveApiKey.mockResolvedValue(viewer);
    expect(await admitApiCaller(request(), { ...READ_PROJECTS, ...limiters })).toBe(viewer);
    expect(resolveApiKey).toHaveBeenCalledWith(RAW_KEY);
    expect(rateLimiter).toHaveBeenCalledTimes(1);
    expect(rateLimiter).toHaveBeenCalledWith('key-1');
  });

  it('refuses a viewer 403 on a capability viewer lacks, before the per-key budget', async () => {
    resolveApiKey.mockResolvedValue(principalWith('viewer'));
    const problem = await problemOf(await admitApiCaller(request(), { ...READ_PRICE_BOOK, ...limiters }));
    expect(problem.status).toBe(403);
    expect(problem.detail).toBe('The role behind this API key may not read this resource.');
    expect(rateLimiter).not.toHaveBeenCalled();
  });
});

describe('the steps before and after the role refusal keep their order', () => {
  it('answers 429 from the pre-auth budget without resolving the key', async () => {
    preAuthRateLimiter.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
    const admitted = await admitApiCaller(request(), { ...READ_PROJECTS, ...limiters });
    expect((await problemOf(admitted)).status).toBe(429);
    expect((admitted as Response).headers.get('retry-after')).toBe('30');
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it('answers 401 for a key that does not resolve, with no per-key budget spent', async () => {
    resolveApiKey.mockResolvedValue(null);
    expect((await problemOf(await admitApiCaller(request(), { ...READ_PROJECTS, ...limiters }))).status).toBe(401);
    expect(rateLimiter).not.toHaveBeenCalled();
  });

  it('answers 429 to an admitted role whose key is over its budget', async () => {
    resolveApiKey.mockResolvedValue(principalWith('owner'));
    rateLimiter.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const admitted = await admitApiCaller(request(), { ...READ_PROJECTS, ...limiters });
    expect((await problemOf(admitted)).status).toBe(429);
    expect((admitted as Response).headers.get('retry-after')).toBe('60');
  });
});
