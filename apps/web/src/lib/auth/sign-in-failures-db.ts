import 'server-only';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';

// The wrong-code counter behind the sign-in pause (security batch 3, P2): the
// two definer functions of packages/db/src/rls/functions/90-sign-in.sql, called
// on the Worker's connection role BEFORE any session or org exists, exactly as
// the token functions are.
//
// A sanctioned base-connection leaf (eslint-rules/no-bare-tenant-db.mjs). It
// runs two fixed statements and takes no SQL from its callers, so it needs no
// runtime guard. Each call is ONE statement and its own transaction, never part
// of a larger one: the record function's deadlock analysis depends on that.
//
// `identifierHash` is the sha256 hex of the canonical identifier
// (sign-in-lockout.ts). The address or phone itself never comes here.

/** The one `seconds` column of the first row: a whole number of seconds, or null. */
function secondsOf(rows: unknown): number | null {
  const seconds = (rows as ReadonlyArray<{ seconds?: unknown }>)[0]?.seconds ?? null;
  if (seconds === null) return null;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    throw new Error('the sign-in pause function answered something that is not a number of seconds');
  }
  return seconds;
}

/** Seconds until the identifier may verify again, or null when it is not paused. ONE statement, read only. */
export async function readSignInPauseSeconds(identifierHash: string): Promise<number | null> {
  const rows = await withRequestDb((db) =>
    db.execute(sql`select public.app_sign_in_pause_seconds(${identifierHash}) as seconds`),
  );
  return secondsOf(rows);
}

/** Counts one wrong code; the seconds of the pause the identifier is now in, or null. ONE statement, a write. */
export async function recordWrongSignInCode(identifierHash: string): Promise<number | null> {
  const rows = await withRequestDb(
    (db) => db.execute(sql`select public.app_sign_in_failure_record(${identifierHash}) as seconds`),
    { write: true },
  );
  return secondsOf(rows);
}
