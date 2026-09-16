// The two runners open a real connection, so `withRequestDb` is replaced by a
// recorder. What is worth proving is not the SQL (drizzle builds it) but the
// shape reading: which row, which column, and what an empty result reads as.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const execute = vi.fn();
vi.mock('@/lib/db/client', () => ({
  withRequestDb: <T>(fn: (db: { execute: typeof execute }) => Promise<T>) =>
    fn({ execute }),
}));

import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode, readSdfJson } from './sdf-call';

// Any token SDF call: the runners now ASSERT this shape before the round trip,
// so a fixture that is not one would be refused before the row-shape reading the
// cases below are about.
const anyQuery = sql`select public.app_proposal_by_token(${'hash'}) as data`;

describe('normalizeRawToken', () => {
  it('refuses absent and blank before any round-trip', () => {
    // The portals are reachable by anyone with the URL; an empty token cannot
    // match a hash, so asking the database is a wasted connection on that path.
    for (const raw of [null, undefined, '', '   ', '\n\t']) {
      expect(normalizeRawToken(raw)).toBeNull();
    }
  });

  it('trims, because a token copied out of WhatsApp carries whitespace', () => {
    expect(normalizeRawToken('  abc123  ')).toBe('abc123');
    expect(normalizeRawToken('abc123\n')).toBe('abc123');
    expect(normalizeRawToken('abc123')).toBe('abc123');
  });
});

describe('readSdfJson', () => {
  it('returns the `data` column of the first row', async () => {
    execute.mockResolvedValueOnce([{ data: { id: 'p1', total: '100.0000' } }]);
    await expect(readSdfJson(anyQuery)).resolves.toEqual({
      id: 'p1',
      total: '100.0000',
    });
  });

  it('reads no row and a SQL NULL alike as "no document"', async () => {
    // An unknown hash, an expired link and a function returning NULL are the
    // same answer to a visitor on purpose — distinguishing them is an oracle.
    execute.mockResolvedValueOnce([]);
    await expect(readSdfJson(anyQuery)).resolves.toBeNull();
    execute.mockResolvedValueOnce([{ data: null }]);
    await expect(readSdfJson(anyQuery)).resolves.toBeNull();
  });
});

describe('the token-SDF shape assertion', () => {
  it('runs a select on a public.app_* function', async () => {
    execute.mockResolvedValueOnce([{ data: 1 }]);
    await expect(
      readSdfJson(sql`select public.app_delivery_by_token(${'hash'}) as data`),
    ).resolves.toBe(1);
    // Leading newline and a multi-line call, as four of the real portals write it.
    execute.mockResolvedValueOnce([{ code: 'ok' }]);
    await expect(
      readSdfCode(sql`
        select public.app_delivery_comment_by_token(
          ${'hash'}, ${'doc'}::uuid
        ) as code`),
    ).resolves.toBe('ok');
  });

  it('refuses an ordinary query, without borrowing a connection', async () => {
    // "These runners only ever call token SDFs" was a comment, and a comment is
    // not a boundary: a security review ran `select * from clients` through this
    // module on the BYPASSRLS socket and got lint-clean, exit 0.
    execute.mockClear();
    const refused = [
      sql`select * from public.clients`,
      sql`select public.other_function(${'x'})`,
      sql`update public.app_delivery set state = 'x'`,
      sql`  select  public.appx_delivery_by_token(${'h'}) as data`,
    ];
    for (const query of refused) {
      await expect(readSdfJson(query)).rejects.toThrow(
        /token SECURITY DEFINER functions only/,
      );
      await expect(readSdfCode(query)).rejects.toThrow(
        /token SECURITY DEFINER functions only/,
      );
    }
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('readSdfCode', () => {
  it('returns the `code` column of the first row', async () => {
    execute.mockResolvedValueOnce([{ code: 'ok' }]);
    await expect(readSdfCode(anyQuery)).resolves.toBe('ok');
    execute.mockResolvedValueOnce([{ code: 'expired' }]);
    await expect(readSdfCode(anyQuery)).resolves.toBe('expired');
  });

  it('returns undefined when the function produced no row', async () => {
    // sdf-result.ts maps undefined to token_invalid, same as any code it does
    // not recognise — so a missing row can never read as success.
    execute.mockResolvedValueOnce([]);
    await expect(readSdfCode(anyQuery)).resolves.toBeUndefined();
  });
});
