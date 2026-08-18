import { describe, expect, it, vi } from 'vitest';

// withRequestDb is server-only and branches on the Cloudflare runtime. Stub
// server-only, fake the cf/context bindings, and replace @metra/db's createDb
// with an in-memory handle so the deadline/pass-through logic runs without a
// real socket. `runtimeState.onCloudflare` flips the branch per test.
const runtimeState = vi.hoisted(() => ({ onCloudflare: true }));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => runtimeState.onCloudflare,
  cfEnv: () => ({ HYPERDRIVE: { connectionString: 'postgres://u:p@host/db' } }),
  cfExecutionContext: () => ({ waitUntil: () => {} }),
}));

vi.mock('@metra/db', () => ({
  createDb: () => ({
    db: { marker: 'db-handle' },
    sql: { end: async () => {} },
  }),
}));

const { withRequestDb, DbDeadlineError } = await import('./client');

describe('withRequestDb — Cloudflare deadline (B1)', () => {
  it('rejects with DbDeadlineError when the operation exceeds the deadline', async () => {
    runtimeState.onCloudflare = true;
    vi.useFakeTimers();
    try {
      // fn never settles — the 15s deadline must win the race.
      const pending = withRequestDb(() => new Promise<never>(() => {}));
      const assertion = expect(pending).rejects.toBeInstanceOf(DbDeadlineError);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
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
