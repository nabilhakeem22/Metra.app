// What a failed studio's line says: the database's own reason and its SQLSTATE,
// found under drizzle's wrapper (whose message is the whole query AND its
// parameters: every name and price of the studio's seed, 178 KB on one line).
// Never the query, never a parameter, never the error `detail` (it can hold
// row data).
import { driverErrorOf } from '@metra/db/sqlstate';

const MAX_REASON = 300;

export function failureReason(error: unknown): string {
  const driver = driverErrorOf(error);
  if (driver && typeof driver.message === 'string') {
    const code = typeof driver.code === 'string' ? `SQLSTATE ${driver.code}: ` : '';
    return `${code}${driver.message}`.slice(0, MAX_REASON);
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('Failed query:') ? 'the database refused a statement (no SQLSTATE reached the client)' : message.slice(0, MAX_REASON);
}
