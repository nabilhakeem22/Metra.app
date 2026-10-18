// A known postgres.js (3.4.9) failure after a LOST connection, kept from
// crashing the CLI. When the server ends a backend inside a transaction (a
// terminated backend, a pooler recycling it) and closes cleanly after its
// FATAL message, as a Linux server does, the driver's own `begin` issues a
// ROLLBACK on the closed connection and its deferred write then runs with no
// socket: an uncaught `TypeError: Cannot read properties of null (reading
// 'write')` from postgres/src/connection.js, in a setImmediate nobody can
// catch. The query it belonged to has already been rejected (the studio's
// outcome is `connection_lost`, seed/run.ts), so it carries no information;
// left alone it kills the process before the run prints its report.
// Anything else uncaught still ends the process, as Node would.

/** Exactly that driver failure: the null-socket write, raised from postgres.js's connection module. */
export function isDriverWriteAfterClose(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const stack = error.stack ?? '';
  return error.message.includes("reading 'write'") && /nextWrite/.test(stack) && /postgres[\\/]src[\\/]connection\.js/.test(stack);
}

/** For the CLI process only (cli.ts): ignore that one failure with one line; anything else uncaught prints and exits 1. */
export function guardDriverWriteAfterClose(): void {
  process.on('uncaughtException', (error) => {
    if (isDriverWriteAfterClose(error)) {
      console.error('market: ignored the database driver writing to a connection that had already closed (the connection was lost)');
      return;
    }
    console.error(error);
    process.exit(1);
  });
}
