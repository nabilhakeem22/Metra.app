import type { SQL } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// chooseConceptByToken: the letter the client SAW travels to the choose SDF,
// and nothing that is not a uuid or a letter ever reaches the database.
const dbState = vi.hoisted(() => ({
  queries: [] as unknown[],
  code: 'ok' as string | undefined,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async (run: (db: { execute: (query: unknown) => unknown }) => unknown) =>
    run({
      execute: (query: unknown) => {
        dbState.queries.push(query);
        return dbState.code === undefined ? [] : [{ code: dbState.code }];
      },
    }),
}));

const { chooseConceptByToken } = await import('./respond');
const { hashShareToken } = await import('@/lib/share/token');

const OPTION = '11111111-1111-4111-8111-111111111111';

/** The values drizzle binds for a built `sql` template, in order. */
function boundValues(query: SQL): unknown[] {
  const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
  return chunks.filter(
    (chunk) => !(chunk && typeof chunk === 'object' && 'value' in chunk && Array.isArray(chunk.value)),
  );
}

afterEach(() => {
  dbState.queries = [];
  dbState.code = 'ok';
});

describe('chooseConceptByToken', () => {
  it('sends the hash, the option, the letter it was seen under, and the capped provenance', async () => {
    expect(
      await chooseConceptByToken(' raw-token ', {
        artifactId: OPTION,
        position: 2,
        note: 'The second',
        ip: '1.2.3.4',
        userAgent: 'probe/1',
      }),
    ).toEqual({ ok: true });
    expect(dbState.queries).toHaveLength(1);
    expect(boundValues(dbState.queries[0] as SQL)).toEqual([
      hashShareToken('raw-token'),
      OPTION,
      2,
      'The second',
      '1.2.3.4',
      'probe/1',
    ]);
  });

  it('maps a repeat to the idempotent `already` and a moved letter to wrong_state', async () => {
    dbState.code = 'already';
    expect(await chooseConceptByToken('raw', { artifactId: OPTION, position: 1 })).toEqual({
      ok: true,
      code: 'already',
    });
    dbState.code = 'wrong_state';
    expect(await chooseConceptByToken('raw', { artifactId: OPTION, position: 1 })).toEqual({
      ok: false,
      error: 'wrong_state',
    });
  });

  it('a blank token is token_invalid with no round trip', async () => {
    expect(await chooseConceptByToken('  ', { artifactId: OPTION, position: 1 })).toEqual({
      ok: false,
      error: 'token_invalid',
    });
    expect(dbState.queries).toEqual([]);
  });

  it.each([
    ['a non-uuid id', { artifactId: 'not-a-uuid', position: 1 }],
    ["an id carrying SQL", { artifactId: `${OPTION}'; drop table x; --`, position: 1 }],
    ['position 0', { artifactId: OPTION, position: 0 }],
    ['position 5', { artifactId: OPTION, position: 5 }],
    ['position 1.5', { artifactId: OPTION, position: 1.5 }],
    ['position NaN', { artifactId: OPTION, position: Number.NaN }],
  ])('%s is wrong_state and never reaches SQL', async (_label, input) => {
    expect(await chooseConceptByToken('raw', input)).toEqual({ ok: false, error: 'wrong_state' });
    expect(dbState.queries).toEqual([]);
  });
});
