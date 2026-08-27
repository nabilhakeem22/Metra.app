import { describe, expect, it, vi } from 'vitest';

// withRequestDb is server-only and branches on the Cloudflare runtime. Stub
// server-only, fake the cf/context bindings, and replace @metra/db's createDb
// with an in-memory handle so the deadline/pass-through logic runs without a
// real socket. `runtimeState.onCloudflare` flips the branch per test.
const runtimeState = vi.hoisted(() => ({ onCloudflare: true }));

// Stable ctx object for the CF branch: getRequestConnection keys its WeakMap on
// this identity, so a single object here models "one request" and lets the shared
// connection be reused across the calls in this suite.
const ctxSingleton = vi.hoisted(() => ({ waitUntil: (_p: Promise<unknown>) => {} }));

vi.mock('server-only', () => ({}));

// getRequestConnection registers request-end teardown via next/server `after`;
// stub it to a no-op so the deadline/pass-through tests run without a Workers
// request context.
vi.mock('next/server', () => ({ after: (_fn: () => unknown) => {} }));

vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => runtimeState.onCloudflare,
  cfEnv: () => ({ HYPERDRIVE: { connectionString: 'postgres://u:p@host/db' } }),
  cfExecutionContext: () => ctxSingleton,
}));

vi.mock('@metra/db', () => ({
  createDb: () => ({
    db: { marker: 'db-handle' },
    sql: { end: async () => {} },
  }),
}));

const { withRequestDb, DbDeadlineError, DbWriteUncertainError } = await import(
  './client'
);

describe('withRequestDb — Cloudflare deadline (B1)', () => {
  it('rejects a READ with DbDeadlineError when the operation exceeds the deadline', async () => {
    runtimeState.onCloudflare = true;
    vi.useFakeTimers();
    try {
      // fn never settles — the 15s deadline must win the race. No `write` flag,
      // so a read: a timed-out SELECT commits nothing, hence the clean error.
      const pending = withRequestDb(() => new Promise<never>(() => {}));
      const assertion = expect(pending).rejects.toBeInstanceOf(DbDeadlineError);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a WRITE with DbWriteUncertainError (ambiguous, may have COMMITted)', async () => {
    runtimeState.onCloudflare = true;
    vi.useFakeTimers();
    try {
      const pending = withRequestDb(() => new Promise<never>(() => {}), {
        write: true,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(
        DbWriteUncertainError,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a WRITE that settles before the deadline is NOT remapped to uncertain', async () => {
    runtimeState.onCloudflare = true;
    const result = await withRequestDb(async () => 'written', { write: true });
    expect(result).toBe('written');
  });

  it('returns the fn result when it settles before the deadline', async () => {
    runtimeState.onCloudflare = true;
    const result = await withRequestDb(async (db) => {
      expect((db as unknown as { marker: string }).marker).toBe('db-handle');
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('off-platform passes straight through with no deadline', async () => {
    runtimeState.onCloudflare = false;
    process.env.DATABASE_URL = 'postgres://u:p@host/db';
    const result = await withRequestDb(async () => 'off-platform');
    expect(result).toBe('off-platform');
  });
});
