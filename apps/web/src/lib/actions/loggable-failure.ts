/**
 * The fields of a caught failure that may be written to the log — a WHITELIST,
 * never the error object.
 *
 * EVERY `console.error`/`console.warn` in this app that has a caught value in
 * its hands goes through here, and `metra/no-raw-error-in-log` is what keeps it
 * that way. Two separate libraries put tenant data on a thrown object, and both
 * of them put it somewhere a `console.error(label, e)` prints by default:
 *
 *  - postgres.js `Object.assign`s every field of the server's ErrorResponse onto
 *    its PostgresError, ENUMERABLE, and for a 23505 `detail` IS the row:
 *    `Key (org_id, email)=(…, someone@example.com) already exists.` The index a
 *    future mutation races is not something a log line can know in advance.
 *  - drizzle-orm, from 0.44, re-throws every query error as a
 *    `DrizzleQueryError` whose OWN enumerable properties are `query`, `params`
 *    and `cause`, and whose message is `Failed query: <sql>\nparams: <values>`.
 *    `util.inspect` — which is what `console.error` calls — prints all of it,
 *    and so does `JSON.stringify` (on 0.36 that printed `{}`).
 *
 * Five fields, all of them describing the SHAPE of the failure rather than the
 * row: `name`, `code`, `constraint_name`, `table_name`, `message`. Together they
 * answer "which constraint on which table refused, and with what SQLSTATE",
 * which is the whole diagnostic value of the line. Strings only, so a field
 * carrying a structured value cannot smuggle an object in.
 *
 * ALL FIVE ARE READ OFF ONE OBJECT: `driverErrorOf`, the level in the `cause`
 * chain the DRIVER threw. Walking field by field would take `constraint_name`
 * off the driver error and `message` off the wrapper, and log exactly what this
 * whitelist exists to keep out.
 *
 * AND WHEN THERE IS NO DRIVER ERROR, THE WRAPPER IS STILL NOT SAFE TO READ —
 * see `isOrmQueryWrapper`.
 *
 * WHAT THIS COSTS: the stack trace, and any field a library invented. That is
 * the trade. A log line that names the constraint and the table is enough to
 * find the statement in the code; a log line carrying a client's phone number is
 * a retention problem in somebody else's jurisdiction.
 */
import { driverErrorOf } from '@metra/db/sqlstate';

const LOGGABLE_ERROR_FIELDS = [
  'name',
  'code',
  'constraint_name',
  'table_name',
  'message',
] as const;

/** What the log says instead of a wrapper's message. */
const ORM_QUERY_WRAPPER = 'DrizzleQueryError';

/**
 * Is this the ORM's query wrapper rather than something worth reading fields off?
 *
 * By its two OWN properties, not by `instanceof` and not by `name`:
 * `DrizzleQueryError`'s constructor sets `query`, `params` and `cause` and never
 * touches `name`, so the thrown object reports itself as a plain 'Error' and an
 * `instanceof` check would bind this module to a deep import of somebody else's
 * package. Own properties only — a driver error that happens to inherit a
 * `query` from a prototype is not this.
 */
function isOrmQueryWrapper(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const own = Object.prototype.hasOwnProperty.bind(e);
  return own('query') && own('params');
}

/** The safe-to-log view of a caught value. Never returns the value itself. */
export function loggableFailure(e: unknown): Record<string, string> {
  const driver = driverErrorOf(e);
  if (!driver && isOrmQueryWrapper(e)) {
    const name = (e as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0
      ? { name, thrown: ORM_QUERY_WRAPPER }
      : { thrown: ORM_QUERY_WRAPPER };
  }
  const source = driver ?? (e as Record<string, unknown> | null | undefined);
  const safe: Record<string, string> = {};
  for (const field of LOGGABLE_ERROR_FIELDS) {
    const value = source?.[field];
    if (typeof value === 'string' && value.length > 0) safe[field] = value;
  }
  // A thrown non-object would otherwise log as `{}`, which reads like a bug in
  // this function rather than a fact about the failure.
  return Object.keys(safe).length > 0 ? safe : { thrown: typeof e };
}
