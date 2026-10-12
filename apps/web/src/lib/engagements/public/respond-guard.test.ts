import type { SQL } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// recordDeliveryActionByToken (Round D): the issuance the client SAW is bound as
// the exact string, a non-stamp never reaches SQL, an instant Postgres cannot
// read is wrong_state rather than a throw, and every client write is a WRITE.
const dbState = vi.hoisted(() => ({
  queries: [] as unknown[],
  code: 'ok' as string | undefined,
  throwing: null as Error | null,
  opts: [] as unknown[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async (run: (db: { execute: (query: unknown) => unknown }) => unknown, opts?: unknown) => {
    dbState.opts.push(opts);
    return run({
      execute: (query: unknown) => {
        dbState.queries.push(query);
        if (dbState.throwing) throw dbState.throwing;
        return dbState.code === undefined ? [] : [{ code: dbState.code }];
      },
    });
  },
}));

const { chooseConceptByToken, recordDeliveryActionByToken } = await import('./respond');
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
  dbState.throwing = null;
  dbState.opts = [];
});

describe('recordDeliveryActionByToken (Round D, the consent guard)', () => {
  const STAMP = '2026-10-10T10:00:00.123456+03:00';

  it('binds the issuance the client saw as the exact string, third of seven', async () => {
    expect(
      await recordDeliveryActionByToken(' raw-token ', {
        action: 'acknowledge_rom',
        expectedIssueAt: STAMP,
        note: null,
        actorName: 'Sam',
        ip: '1.2.3.4',
        userAgent: 'probe/1',
      }),
    ).toEqual({ ok: true });
    expect(boundValues(dbState.queries[0] as SQL)).toEqual([
      hashShareToken('raw-token'),
      'acknowledge_rom',
      STAMP,
      null,
      'Sam',
      '1.2.3.4',
      'probe/1',
    ]);
  });

  it('null is bound as null (the verbs that name no issuance, a legacy round)', async () => {
    await recordDeliveryActionByToken('raw', { action: 'acknowledge_handoff', expectedIssueAt: null });
    expect(boundValues(dbState.queries[0] as SQL)[2]).toBeNull();
  });

  it.each(['yesterday', '2026-10-10', `${STAMP}; select 1`, '2026-10-10T10:00:00.123456789Z'])(
    'a non-stamp (%s) is wrong_state and never reaches SQL',
    async (expectedIssueAt) => {
      expect(await recordDeliveryActionByToken('raw', { action: 'approve_design', expectedIssueAt })).toEqual({
        ok: false,
        error: 'wrong_state',
      });
      expect(dbState.queries).toEqual([]);
    },
  );
});

describe('recordDeliveryActionByToken: an instant Postgres cannot read (D3 F7, L1)', () => {
  /** A driver error wrapped the way drizzle wraps it (the SQLSTATE one level down). */
  const wrapped = (code: string) => Object.assign(new Error('Failed query: select ... params: HASH,NOTE'), { cause: { code } });

  it.each(['22007', '22008', '22009'])('SQLSTATE %s is wrong_state, not a throw', async (sqlstate) => {
    dbState.throwing = wrapped(sqlstate);
    expect(await recordDeliveryActionByToken('raw', { action: 'approve_design', expectedIssueAt: '2026-10-12T25:61:61Z' })).toEqual({
      ok: false,
      error: 'wrong_state',
    });
  });

  it('any other failure still throws (the caller logs it redacted)', async () => {
    dbState.throwing = wrapped('57014');
    await expect(recordDeliveryActionByToken('raw', { action: 'approve_design', expectedIssueAt: null })).rejects.toThrow();
  });

  it('every client write is marked a WRITE for the request deadline', async () => {
    await recordDeliveryActionByToken('raw', { action: 'acknowledge_handoff', expectedIssueAt: null });
    await chooseConceptByToken('raw', { artifactId: OPTION, position: 1 });
    expect(dbState.opts).toEqual([{ write: true }, { write: true }]);
  });
});
