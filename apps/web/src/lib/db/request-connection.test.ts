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

const { HELD_WORK_CAP_MS, getRequestConnection, holdRequestConnectionUntil } = await import('./request-connection');

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

  // BEFORE the hold existed, the teardown ended the socket at once, so work that
  // ran on after the response failed every statement it started afterwards with
  // CONNECTION_ENDED (the handover close's later steps). The test above is that
  // unheld behaviour, kept for work nobody holds.
  it('waits for held work before it ends the connection, which stays the same until then', async () => {
    const { sql } = getRequestConnection();
    const endSpy = sql.end as unknown as ReturnType<typeof vi.fn>;
    let finish!: () => void;
    holdRequestConnectionUntil(new Promise<void>((resolve) => { finish = resolve; }));
    await afterCallbacks[0]();
    const drained = runtime.ctx.waitUntil.mock.calls[0][0] as Promise<void>;
    await Promise.resolve();
    expect(endSpy).not.toHaveBeenCalled();
    expect(getRequestConnection().sql).toBe(sql);
    finish();
    await drained;
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(createDbMock).toHaveBeenCalledTimes(1);
  });

  it('still ends after held work that fails, and holds nothing once the teardown began', async () => {
    const { sql } = getRequestConnection();
    const endSpy = sql.end as unknown as ReturnType<typeof vi.fn>;
    holdRequestConnectionUntil(Promise.reject(new Error('the close failed')));
    await afterCallbacks[0]();
    holdRequestConnectionUntil(new Promise(() => {}));
    await (runtime.ctx.waitUntil.mock.calls[0][0] as Promise<void>);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  // R6: a held work item that never settles kept the teardown waiting, and the
  // connection open, until the platform's waitUntil limit.
  it('ends the connection at the cap when held work never settles, with one redacted line', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { sql } = getRequestConnection();
      const endSpy = sql.end as unknown as ReturnType<typeof vi.fn>;
      holdRequestConnectionUntil(new Promise(() => {}));
      await afterCallbacks[0]();
      const drained = runtime.ctx.waitUntil.mock.calls[0][0] as Promise<void>;
      await vi.advanceTimersByTimeAsync(HELD_WORK_CAP_MS - 1);
      expect(endSpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await drained;
      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith('request connection ended with held work still running:', { heldWork: 1, capMs: HELD_WORK_CAP_MS });
    } finally {
      logged.mockRestore();
      vi.useRealTimers();
    }
  });

  it('logs nothing when held work settles before the cap', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      getRequestConnection();
      holdRequestConnectionUntil(Promise.resolve());
      await afterCallbacks[0]();
      await (runtime.ctx.waitUntil.mock.calls[0][0] as Promise<void>);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('throws off-platform (getDb is the correct path there)', () => {
    runtime.onCloudflare = false;
    expect(() => getRequestConnection()).toThrow(/Cloudflare-runtime only/);
  });
});
