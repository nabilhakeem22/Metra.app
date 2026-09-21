/**
 * Is this thrown DB error an AMBIGUOUS outcome rather than a clean failure?
 *
 * A coded refusal rolls its own transaction back and nothing committed. These
 * SQLSTATEs are different: each one can be raised by a statement whose SIBLING —
 * an earlier attempt at the very same act, still alive at Postgres — may be
 * about to COMMIT. Treating them as a plain failure is what let a retry decide
 * the first attempt was dead, mint a fresh idempotency key and spend a second
 * free revision.
 *
 *  - `55P03` lock_not_available — our `lock_timeout` fired while waiting on a row
 *    lock. Something else holds that lock; on the retry path that something is
 *    usually the abandoned first attempt, which is still free to commit.
 *  - `57014` query_canceled — a statement_timeout or an explicit cancel. The
 *    cancel races the commit, so the answer is genuinely unknown.
 *  - class `08` connection_exception — the socket died between sending COMMIT and
 *    reading its reply. The canonical ambiguous write.
 *
 * Pure and dependency-free so it is unit-testable without a database: it reads
 * the error's SQLSTATE through `sqlstateOf`, which finds it whether postgres.js
 * threw it directly or drizzle wrapped it in a `DrizzleQueryError` first. Both
 * shapes reach this function on the same path: the driver raises the class-08
 * and lock-timeout errors itself, while a statement the ORM ran arrives wrapped.
 */
import { sqlstateOf } from '@metra/db/sqlstate';

const AMBIGUOUS_SQLSTATES: ReadonlySet<string> = new Set([
  '55P03',
  '57014',
  // admin_shutdown: what the pooler raises when it recycles a backend under a
  // write in flight. The server is gone; whether COMMIT landed is unknown.
  '57P01',
]);

/** SQLSTATE class 08 — connection_exception, every member of it. */
const CONNECTION_EXCEPTION_CLASS = '08';

/**
 * A socket that actually dies never produces a server SQLSTATE at all:
 * postgres.js raises its own connection errors with these `code` values
 * (see node_modules/postgres/src/errors.js). They are the class-08 outcome in
 * practice, so they are ambiguous for exactly the same reason.
 *
 * THE LAST THREE ARE NODE'S, NOT THE DRIVER'S, and they are the ones that were
 * missing. When the socket fails below postgres.js — a pooler recycling a
 * backend, a Hyperdrive hop dropping — what surfaces is the libuv error verbatim
 * (`ECONNRESET` mid-statement is the canonical ambiguous write), sometimes
 * inside an `AggregateError` when one host resolved to several addresses. They
 * are unlisted here today, so they fall to `generic`, and `generic` is NOT in
 * DEFINITE_REFUSALS — which means the cockpit DROPS the held idempotency key and
 * the retry mints a fresh one for an attempt that may have committed.
 *
 * `ECONNREFUSED` and a connect-phase `ETIMEDOUT` did not reach the server at
 * all, so strictly they are definite failures. They are listed anyway, for the
 * same reason `CONNECT_TIMEOUT` and the whole of class 08 (which includes 08001
 * "unable to connect") already are: this module's job is to name what we cannot
 * be SURE about, and Node does not tell us whether an `ETIMEDOUT` fired during
 * the handshake or on a statement in flight. Holding a key that could have been
 * released costs nothing; releasing one that should have been held is the
 * double-apply the retry policy exists to prevent.
 *
 * NOT listed, deliberately: `MAX_PARAMETERS_EXCEEDED`. postgres.js raises it
 * BEFORE sending anything, so nothing can have committed — it is a definite
 * failure, and calling it ambiguous would only mislabel it.
 */
const DRIVER_CONNECTION_CODES: ReadonlySet<string> = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECT_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
]);

export function isAmbiguousDbOutcome(error: unknown): boolean {
  const code = sqlstateOf(error);
  if (code === undefined) return false;
  return (
    AMBIGUOUS_SQLSTATES.has(code) ||
    DRIVER_CONNECTION_CODES.has(code) ||
    code.startsWith(CONNECTION_EXCEPTION_CLASS)
  );
}
