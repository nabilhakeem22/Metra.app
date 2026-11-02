/**
 * A database failure, redacted at the one place every query leaves through.
 *
 * WHY THIS EXISTS: the app's own log sinks go through `loggableFailure`, but
 * a failure nobody catches does not. When a Server Component render throws,
 * Next's route module prints the thrown value itself (`console.error(err)` in
 * `RouteModule.onRequestError`, BEFORE the instrumentation hook runs, so no
 * hook can scrub it). For drizzle's `DrizzleQueryError` that print is
 * `Failed query: <sql>`, `params: [...]` and the driver error under it, whose
 * `detail` is the colliding row on a 23505. Personal data in the Worker log.
 *
 * So the thrown value is replaced before it can reach any printer: an error
 * carrying exactly the `loggableFailure` whitelist of the original. No query,
 * no params, no `detail`, no `cause`. What every reader of a database failure
 * asks for stays on it, at the top level where `sqlstateOf` and
 * `driverRefusalOf` look first: the SQLSTATE (`code`) and the
 * `constraint_name` of the same driver error, so 55P03, 40P01, 23505, 23514
 * and MT100 are answered as before, and `loggableFailure` of the redacted error
 * is the line it wrote for the original. The reference id is Next's `digest`,
 * which Next stamps on this object before printing it and shows on the page.
 *
 * WHAT THIS COSTS: the original stack. The redacted error's stack starts where
 * it was rethrown. A log line naming the SQLSTATE, the table and the
 * constraint, under the request path and the digest, is enough to find the
 * statement.
 */
import { isOrmQueryWrapper, loggableFailure } from '@/lib/actions/loggable-failure';

/** The whitelisted fields that describe the failure rather than the row. */
const FAILURE_SHAPE_FIELDS = ['code', 'constraint_name', 'table_name'] as const;

/** The message when the whitelist kept none (a data exception, a bare wrapper). */
const WITHHELD_MESSAGE = 'database query failed';

/** The original's whitelist, and nothing that could carry a value. */
export class RedactedDatabaseError extends Error {
  constructor(loggable: Record<string, string>) {
    super(loggable.message ?? WITHHELD_MESSAGE);
    this.name = loggable.name ?? 'DatabaseError';
    for (const field of FAILURE_SHAPE_FIELDS) {
      const value = loggable[field];
      if (value !== undefined) Object.defineProperty(this, field, { value, enumerable: true });
    }
  }
}

/**
 * Is the THROWN value itself the ORM's query wrapper or a driver error that the
 * server sent? Only the top level: an app error (an `ActionError` with its own
 * `code`, a deadline) is answered by `instanceof` upstream and must pass
 * through as the same object. A server error is told apart from an app error by
 * `severity`, a field postgres.js copies off every ErrorResponse.
 */
function isDatabaseFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  if (isOrmQueryWrapper(error)) return true;
  try {
    const own = Object.prototype.hasOwnProperty.bind(error);
    return own('severity') && own('code');
  } catch {
    // A value that will not say what it carries is treated as carrying it.
    return true;
  }
}

/** Rethrow `error`, redacted when it is a database failure, untouched otherwise. */
export function throwRedactedDatabaseFailure(error: unknown): never {
  throw isDatabaseFailure(error) ? new RedactedDatabaseError(loggableFailure(error)) : error;
}
