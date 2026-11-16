import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The sign-in pause's database leaf (security batch 3, P2): each call is ONE
// statement on the connection role, names its own definer function, binds the
// hash as a parameter, and only the record call is declared a write. The
// connection is an in-memory handle that keeps what it was asked to run.

interface Call {
  statements: SQL[];
  options: { write?: boolean } | undefined;
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: [] as unknown[],
  failure: null as Error | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({
  withRequestDb: async (run: (handle: { execute: (query: SQL) => unknown }) => unknown, options?: { write?: boolean }) => {
    const call: Call = { statements: [], options };
    db.calls.push(call);
    return run({
      execute: (query) => {
        call.statements.push(query);
        if (db.failure) throw db.failure;
        return db.rows;
      },
    });
  },
}));

const { readSignInPauseSeconds, recordWrongSignInCode } = await import('./sign-in-failures-db');

const HASH = 'a'.repeat(64);
const dialect = new PgDialect();

/** The one statement of the one connection call, as the driver receives it. */
function onlyStatement(): { sql: string; params: unknown[] } {
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]!.statements).toHaveLength(1);
  const { sql, params } = dialect.sqlToQuery(db.calls[0]!.statements[0]!);
  return { sql, params };
}

beforeEach(() => {
  db.calls = [];
  db.rows = [];
  db.failure = null;
});

describe('readSignInPauseSeconds', () => {
  it('runs one statement, the pause function with the hash bound, and declares no write', async () => {
    db.rows = [{ seconds: 1800 }];
    expect(await readSignInPauseSeconds(HASH)).toBe(1800);
    expect(onlyStatement()).toEqual({ sql: 'select public.app_sign_in_pause_seconds($1) as seconds', params: [HASH] });
    expect(db.calls[0]!.options?.write).toBeUndefined();
  });

  it.each([
    ['a NULL answer', [{ seconds: null }]],
    ['a row without the column', [{}]],
    ['no row at all', []],
  ])('answers null for %s', async (_case, rows) => {
    db.rows = rows;
    expect(await readSignInPauseSeconds(HASH)).toBeNull();
  });

  it.each([
    ['a string', '1800'],
    ['not a number', Number.NaN],
    ['an object', { seconds: 1800 }],
  ])('throws on an answer that is %s, never reading it as "not paused"', async (_case, seconds) => {
    db.rows = [{ seconds }];
    await expect(readSignInPauseSeconds(HASH)).rejects.toThrow('not a number of seconds');
  });

  it('lets a database failure through to its caller', async () => {
    db.failure = new Error('connection ended');
    await expect(readSignInPauseSeconds(HASH)).rejects.toBe(db.failure);
  });
});

describe('recordWrongSignInCode', () => {
  it('runs one statement, the record function with the hash bound, declared a write', async () => {
    db.rows = [{ seconds: 3600 }];
    expect(await recordWrongSignInCode(HASH)).toBe(3600);
    expect(onlyStatement()).toEqual({ sql: 'select public.app_sign_in_failure_record($1) as seconds', params: [HASH] });
    expect(db.calls[0]!.options).toEqual({ write: true });
  });

  it('answers null while the identifier is not paused', async () => {
    db.rows = [{ seconds: null }];
    expect(await recordWrongSignInCode(HASH)).toBeNull();
  });

  it('lets a database failure through to its caller', async () => {
    db.failure = new Error('lock timeout');
    await expect(recordWrongSignInCode(HASH)).rejects.toBe(db.failure);
  });
});
