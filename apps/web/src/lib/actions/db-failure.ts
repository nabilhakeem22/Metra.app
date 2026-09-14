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
 * only the `code` property postgres.js copies off the server's error response.
 */
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
 */
const DRIVER_CONNECTION_CODES: ReadonlySet<string> = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'CONNECT_TIMEOUT',
]);

export function isAmbiguousDbOutcome(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return (
    AMBIGUOUS_SQLSTATES.has(code) ||
    DRIVER_CONNECTION_CODES.has(code) ||
    code.startsWith(CONNECTION_EXCEPTION_CLASS)
  );
}
