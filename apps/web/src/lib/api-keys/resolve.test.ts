import { beforeEach, describe, expect, it, vi } from 'vitest';

// resolveApiKey is server-only and opens a request-scoped DB transaction. Stub
// server-only and replace withRequestDb with a spy so we can prove the STRICT
// format gate (R1/S2) short-circuits BEFORE any DB work.
vi.mock('server-only', () => ({}));
const withRequestDb = vi.fn(async () => null);
vi.mock('@/lib/db/client', () => ({ withRequestDb }));

const { resolveApiKey } = await import('./resolve');

// A syntactically valid raw key: mtk_ + 43 base64url chars.
const VALID = `mtk_${'A'.repeat(43)}`;

beforeEach(() => {
  withRequestDb.mockClear();
});

describe('resolveApiKey — strict format gate (R1/S2)', () => {
  const malformed: Array<string | null | undefined> = [
    undefined,
    null,
    '',
    'garbage',
    'Bearer something',
    'mtk_', // prefix only
    'mtk_short',
    `mtk_${'A'.repeat(42)}`, // one char too short
    `mtk_${'A'.repeat(44)}`, // one char too long
    `mtk_${'A'.repeat(42)}!`, // right length, illegal char
    `mtk_${'A'.repeat(42)} `, // trailing space inside length
  ];

  it('returns null for a malformed key WITHOUT any DB call', async () => {
    for (const key of malformed) {
      const result = await resolveApiKey(key);
      expect(result, `should reject: ${String(key)}`).toBeNull();
    }
    // The DB is never touched for any malformed key.
    expect(withRequestDb).not.toHaveBeenCalled();
  });

  it('a well-formed but unknown key DOES reach the DB and resolves null', async () => {
    const result = await resolveApiKey(VALID);
    expect(result).toBeNull();
    expect(withRequestDb).toHaveBeenCalledTimes(1);
  });
});
