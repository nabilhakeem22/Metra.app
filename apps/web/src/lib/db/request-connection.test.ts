import { beforeEach, describe, expect, it, vi } from 'vitest';

// getRequestConnection is Cloudflare-only and shares ONE postgres.js instance
// across a request. Stub server-only, capture next/server `after` callbacks,
// control the runtime flag + request ctx, and count createDb so we can assert the
// single-instance / once-only-teardown contract without a real Workers runtime.
const runtime = vi.hoisted(() => ({
  onCloudflare: true,
  ctx: { waitUntil: vi.fn() as ReturnType<typeof vi.fn> },
}));

const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);

const createDbMock = vi.hoisted(() =>
  vi.fn(() => ({
    db: { marker: 'db-handle' },
    sql: { end: vi.fn(async () => {}) },
  })),
);

vi.mock('server-only', () => ({}));

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    afterCallbacks.push(fn);
  },
}));

vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => runtime.onCloudflare,
  cfEnv: () => ({ HYPERDRIVE: { connectionString: 'postgres://u:p@host/db' } }),
  cfExecutionContext: () => runtime.ctx,
}));

vi.mock('@metra/db', () => ({ createDb: createDbMock }));

const { getRequestConnection } = await import('./request-connection');

describe('getRequestConnection — shared request-scoped connection', () => {
  beforeEach(() => {
    runtime.onCloudflare = true;
    // Fresh ctx per test = fresh request (module WeakMap keyed on ctx identity).
    runtime.ctx = { waitUntil: vi.fn() };
    afterCallbacks.length = 0;
    createDbMock.mockClear();
  });

  it('creates ONE instance and returns the same handle across N calls in one request', () => {
    const first = getRequestConnection();
    // Model a cockpit render's ~11 withRequestDb calls in the same request.
    const rest = Array.from({ length: 10 }, () => getRequestConnection());
    for (const r of rest) {
      expect(r.db).toBe(first.db);
      expect(r.sql).toBe(first.sql);
    }
    expect(createDbMock).toHaveBeenCalledTimes(1);
    // Teardown registered exactly once, not once per call.
    expect(afterCallbacks).toHaveLength(1);
  });

  it('opens a distinct connection for a different request ctx', () => {
    const a = getRequestConnection();
    runtime.ctx = { waitUntil: vi.fn() };
    const b = getRequestConnection();
    expect(b.db).not.toBe(a.db);
    expect(createDbMock).toHaveBeenCalledTimes(2);
    expect(afterCallbacks).toHaveLength(2);
  });

  it('closes the shared connection exactly once via after() teardown', async () => {
    const { sql } = getRequestConnection();
    const endSpy = sql.end as unknown as ReturnType<typeof vi.fn>;

    // Request ends: run the registered teardown.
    await afterCallbacks[0]();
    expect(runtime.ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);

    // A second teardown invocation is a guarded no-op (idempotent close).
    await afterCallbacks[0]();
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('throws off-platform (getDb is the correct path there)', () => {
    runtime.onCloudflare = false;
    expect(() => getRequestConnection()).toThrow(/Cloudflare-runtime only/);
  });
});
