import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  InvalidCursorError,
  MAX_LIMIT,
  buildPage,
  clampLimit,
  decodeCursor,
  encodeCursor,
  parsePageParams,
} from './pagination';

const ID_A = '00000000-0000-4000-8000-0000000000a1';
const ID_B = '00000000-0000-4000-8000-0000000000b1';
// Microsecond-precision timestamps (6 fractional digits) — the DB precision.
const TS_A = '2026-08-19T10:00:00.123456Z';
const TS_B = '2026-08-18T10:00:00.123456Z';

function encodeRaw(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

describe('clampLimit', () => {
  it('defaults when absent/blank/non-numeric', () => {
    expect(clampLimit(null)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(clampLimit('')).toBe(DEFAULT_LIMIT);
    expect(clampLimit('abc')).toBe(DEFAULT_LIMIT);
    expect(clampLimit('0')).toBe(DEFAULT_LIMIT);
    expect(clampLimit('-5')).toBe(DEFAULT_LIMIT);
    expect(clampLimit('2.5')).toBe(DEFAULT_LIMIT);
  });

  it('clamps over-max to MAX_LIMIT (500 -> 100)', () => {
    expect(clampLimit('500')).toBe(MAX_LIMIT);
    expect(clampLimit('101')).toBe(MAX_LIMIT);
  });

  it('honors a valid in-range limit', () => {
    expect(clampLimit('25')).toBe(25);
    expect(clampLimit('1')).toBe(1);
    expect(clampLimit('100')).toBe(100);
  });
});

describe('cursor round-trip (full-microsecond precision, F1)', () => {
  it('encodes and decodes losslessly, preserving the microseconds', () => {
    const cursor = { ts: TS_A, id: ID_A };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects a structurally malformed cursor', () => {
    expect(() => decodeCursor('not-base64!!!')).toThrow(InvalidCursorError);
    expect(() => decodeCursor(encodeRaw({}))).toThrow(InvalidCursorError);
    expect(() => decodeCursor(encodeRaw({ t: TS_A, i: 'not-a-uuid' }))).toThrow(
      InvalidCursorError,
    );
  });

  // F2: timestamps that Date.parse accepts but Postgres ::timestamptz rejects (or
  // that are otherwise not our exact microsecond format) must 400, not 500.
  it('rejects timestamps that are valid-JS but not the microsecond format (F2)', () => {
    for (const t of [
      '2026',
      '0',
      '2026-08',
      '2026-08-19',
      '2026-08-19T10:00:00.000Z', // millisecond precision — not 6 digits
      '2026-08-19T10:00:00Z', // no fractional
      '2026-08-19T10:00:00.123456+00:00', // offset form, not 'Z'
    ]) {
      expect(() => decodeCursor(encodeRaw({ t, i: ID_A })), t).toThrow(
        InvalidCursorError,
      );
    }
  });
});

describe('parsePageParams', () => {
  it('parses limit + cursor from the URL', () => {
    const cursor = encodeCursor({ ts: TS_A, id: ID_A });
    const url = new URL(`https://x/api/v1/clients?limit=500&cursor=${cursor}`);
    const params = parsePageParams(url);
    expect(params.limit).toBe(100);
    expect(params.cursor).toEqual({ ts: TS_A, id: ID_A });
  });

  it('throws on a malformed cursor', () => {
    const url = new URL('https://x/api/v1/clients?cursor=@@@');
    expect(() => parsePageParams(url)).toThrow(InvalidCursorError);
  });
});

describe('buildPage', () => {
  const rows = [
    { id: ID_A, cursorTs: TS_A },
    { id: ID_B, cursorTs: TS_B },
  ];

  it('returns a nextCursor from the last item when a further page exists', () => {
    const { items, nextCursor } = buildPage(rows, 1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(ID_A);
    expect(nextCursor).not.toBeNull();
    // The cursor points at the last RETURNED row (full precision) so the next page
    // starts strictly after it (no dup, no gap).
    expect(decodeCursor(nextCursor!)).toEqual({ ts: TS_A, id: ID_A });
  });

  it('returns null nextCursor when there is no further page', () => {
    const { items, nextCursor } = buildPage(rows, 5);
    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it('carries the full-precision cursorTs verbatim (no truncation)', () => {
    const { nextCursor } = buildPage(rows, 1);
    expect(decodeCursor(nextCursor!).ts).toBe(TS_A);
  });
});
