import { randomBytes } from 'node:crypto';
import { ownerQuery } from './execution-fixture';

// Shared by the sign-in pause DB tests (security batch 3, P2). Not a test file.
// sign_in_failures is not org-scoped, so no fixture teardown reaches it: every
// case takes its hashes from freshHash() and removePlanted() deletes them.

const planted: string[] = [];

/** A random, well-formed identifier hash that removePlanted() will delete. */
export function freshHash(): string {
  const hash = randomBytes(32).toString('hex');
  planted.push(hash);
  return hash;
}

/** Deletes every row a freshHash() of this file's run could have left. */
export async function removePlanted(): Promise<void> {
  await ownerQuery(`delete from public.sign_in_failures where identifier_hash = any($1::text[])`, [planted]);
  planted.length = 0;
}

/** Counts one wrong code as the connection role; the pause in seconds, or null. */
export async function record(hash: string | null): Promise<number | null> {
  const [row] = await ownerQuery<{ seconds: number | null }>(`select public.app_sign_in_failure_record($1) as seconds`, [hash]);
  return row.seconds;
}

/** The pre-check as the connection role: seconds left, or null when not paused. */
export async function pauseSeconds(hash: string): Promise<number | null> {
  const [row] = await ownerQuery<{ seconds: number | null }>(`select public.app_sign_in_pause_seconds($1) as seconds`, [hash]);
  return row.seconds;
}

/** The row's count, or undefined when the identifier has no row. */
export async function failuresOf(hash: string): Promise<number | undefined> {
  const rows = await ownerQuery<{ failures: number }>(`select failures from public.sign_in_failures where identifier_hash = $1`, [hash]);
  return rows[0]?.failures;
}
