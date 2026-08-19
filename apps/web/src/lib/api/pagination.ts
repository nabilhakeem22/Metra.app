// Opaque cursor pagination for the Public API (v1). Pure — no server-only deps.
// Stable total order is (created_at desc, id desc); the cursor is a base64url of
// {ts,id}, where `ts` is a FULL-microsecond ISO timestamp string
// (YYYY-MM-DDTHH:MM:SS.ffffffZ) — matching Postgres' microsecond precision so no
// row sharing a millisecond is ever skipped (F1). Malformed cursor -> the caller
// emits a 400 problem (InvalidCursorError).

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** The keyset a cursor encodes: the last row's (created_at, id). */
export interface Cursor {
  /** Microsecond-precision ISO timestamp: YYYY-MM-DDTHH:MM:SS.ffffffZ. */
  ts: string;
  id: string;
}

/** Thrown by decodeCursor on any malformed/tampered cursor. */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// EXACT microsecond ISO (6 fractional digits, UTC 'Z'). Strict so a cursor
// timestamp can never be a value Postgres ::timestamptz would reject at cast
// time (F2) — e.g. "2026", "0", "2026-08" all fail here and 400 up front.
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * Clamp a raw `limit` query value to [1, MAX_LIMIT], default DEFAULT_LIMIT. A
 * non-numeric/absent value falls back to the default; over-max clamps to MAX_LIMIT
 * (e.g. 500 -> 100), never rejects.
 */
export function clampLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return DEFAULT_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(n, MAX_LIMIT);
}

/** base64url-encode {ts,id}. */
export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ t: cursor.ts, i: cursor.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode + validate a cursor. Throws InvalidCursorError on anything malformed. */
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidCursorError();
  }
  const { t, i } = parsed as { t?: unknown; i?: unknown };
  if (typeof t !== 'string' || typeof i !== 'string') {
    throw new InvalidCursorError();
  }
  if (!UUID_RE.test(i)) throw new InvalidCursorError();
  // Strict full-microsecond format — NOT a loose Date.parse (F2). Anything the
  // DB ::timestamptz cast would choke on is rejected here as a 400, not a 500.
  if (!CURSOR_TS_RE.test(t)) throw new InvalidCursorError();
  return { ts: t, id: i };
}

export interface PageParams {
  limit: number;
  cursor: Cursor | null;
}

/** Parse `limit` + `cursor` from a URL's search params. */
export function parsePageParams(url: URL): PageParams {
  const cursorRaw = url.searchParams.get('cursor');
  return {
    limit: clampLimit(url.searchParams.get('limit')),
    cursor: cursorRaw ? decodeCursor(cursorRaw) : null,
  };
}

/**
 * A row carrying the keyset columns. `cursorTs` is the FULL-microsecond ISO
 * timestamp string the list query computes with to_char (never a truncated JS
 * Date) so the encoded cursor matches the DB value exactly (F1).
 */
export interface Keyed {
  id: string;
  cursorTs: string;
}

export interface Page<T extends Keyed> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Given `limit + 1` fetched rows, return exactly `limit` items plus the
 * nextCursor (or null when there is no further page). The caller fetches one
 * extra row purely to detect "is there more" without a COUNT.
 */
export function buildPage<T extends Keyed>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ ts: last.cursorTs, id: last.id }) : null;
  return { items, nextCursor };
}
