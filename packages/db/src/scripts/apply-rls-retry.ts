// One rls/ file, applied, and applied AGAIN when ordinary traffic made it lose a
// lock race (B4 reliability R1). Each file goes over the simple protocol as ONE
// implicit transaction, so a failed file rolled back whole and the files
// before it stay applied; every statement under rls/ is idempotent, so running
// the same file again is exactly what an operator re-running apply-rls does.
//
// WHY A FILE LOSES. policies/00-core.sql takes ACCESS EXCLUSIVE on
// `organizations`, then on `memberships`. An app write takes them the other way
// round: AccessShare on `memberships` first (the RLS predicate's membership
// check), then RowShare on `organizations` (its org_id foreign key). Two
// sub-second transactions in opposite orders are a deadlock (40P01), measured
// at 3 or more studio writes a second; policies/40-engagements.sql meets the
// delivery snapshot the same way. A reader holding a table past the 3 s
// `lock_timeout` is the other loser (55P03). Neither is a fault of the file.
//
// NARROW ON PURPOSE: only those two SQLSTATEs are retried, at most
// APPLY_ATTEMPTS times per file, with a short pause between. Anything else
// fails on its first attempt, as before, and the last failure is thrown as it
// came, so the operator's two `apply-rls failed:` lines are unchanged.
import { sqlstateOf } from '../sqlstate';

/** The lock races a re-run settles: deadlock_detected and lock_not_available. */
export const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40P01', '55P03']);

/** Tries per file, the first included. */
export const APPLY_ATTEMPTS = 3;

/** The pause before attempt 2 and before attempt 3. */
export const RETRY_PAUSES_MS: readonly number[] = [2_000, 4_000];

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

const realDeps: RetryDeps = {
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  log: (line) => console.log(line),
};

/** Run `apply` (one file's transaction) until it lands, a non-race error, or the last attempt. */
export async function applyFileWithRetry(
  file: string,
  apply: () => Promise<unknown>,
  deps: RetryDeps = realDeps,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await apply();
      return;
    } catch (error) {
      const code = sqlstateOf(error);
      if (code === undefined || !RETRYABLE_SQLSTATES.has(code) || attempt >= APPLY_ATTEMPTS) throw error;
      const pause = RETRY_PAUSES_MS[attempt - 1];
      deps.log(
        `apply-rls: ${file} rolled back with SQLSTATE ${code} on attempt ${String(attempt)} of ` +
          `${String(APPLY_ATTEMPTS)} (a lock race with live traffic); trying it again in ${String(pause / 1000)} s.`,
      );
      await deps.sleep(pause);
      deps.log(`Applying ${file} ... (attempt ${String(attempt + 1)} of ${String(APPLY_ATTEMPTS)})`);
    }
  }
}
