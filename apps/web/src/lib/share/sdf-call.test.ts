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

const anyQuery = sql`select 1 as data`;

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
