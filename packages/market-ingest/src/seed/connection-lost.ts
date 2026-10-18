// Whether a studio's failure was the CLI's connection to the database going
// away (a dropped link, a terminated backend, a pooler recycling it) rather
// than a refusal of that studio. The run cannot go on meaningfully on a
// connection it lost, and the studio's own outcome is then unknown if its
// commit was in flight, so the run stops there and says so (./run.ts).
import { sqlstateOf } from '@metra/db/sqlstate';

/** postgres.js's own connection codes, Node's socket codes, and the server's shutdown SQLSTATEs (57P01 admin, 57P02 crash, 57P03 cannot connect now). */
const CONNECTION_LOST_CODES: ReadonlySet<string> = new Set([
  'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED', 'CONNECT_TIMEOUT',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
  '57P01', '57P02', '57P03',
]);

/** SQLSTATE class 08, connection_exception. */
const CONNECTION_EXCEPTION_CLASS = '08';

export function isConnectionLost(error: unknown): boolean {
  const code = sqlstateOf(error);
  return code !== undefined && (CONNECTION_LOST_CODES.has(code) || code.startsWith(CONNECTION_EXCEPTION_CLASS));
}
