// What `db:migrate` and `db:apply-rls` print when they fail: the SQLSTATE, the
// driver's own one-line message, and what the operator should do next.
//
// WHY. drizzle-orm wraps every query error in a DrizzleQueryError whose message
// is the whole failed SQL (for a migration, the entire file) and whose `cause`
// is the driver error carrying the SQLSTATE. Printing `err.message` alone made a
// 23514 ("stop and ask") and a 55P03 ("re-run later") print the SAME line, with
// neither code. The driver error is found with the repo's cause-walking reader
// (../sqlstate.ts). Its `detail` is never printed: for a constraint violation
// the server can put row data there.
import { driverErrorOf } from '../sqlstate';

/** The two schema scripts, and what a rolled-back failure leaves behind in each. */
export type SchemaScript = 'migrate' | 'apply-rls';

const PREFIX: Record<SchemaScript, string> = {
  migrate: 'Migration failed',
  'apply-rls': 'apply-rls failed',
};

/** What rolled back: the migrator runs the whole batch in ONE transaction. */
const ROLLED_BACK: Record<SchemaScript, string> = {
  migrate: 'the whole batch rolled back, nothing was changed',
  'apply-rls': 'this file rolled back; the files before it stay applied',
};

/** The next step for a SQLSTATE, or a generic one for any other code. */
function hintFor(script: SchemaScript, code: string | undefined): string {
  if (code === '23514') {
    return `STOP, tell the lead (a CHECK refused existing rows; ${ROLLED_BACK[script]}).`;
  }
  if (code === '55P03' || code === '40P01') {
    return `lock wait or deadlock, safe to re-run at a quieter moment (${ROLLED_BACK[script]}).`;
  }
  return `tell the lead before running anything else (${ROLLED_BACK[script]}).`;
}

/** The lines to print for a failed schema script: code and message, then the hint. */
export function schemaScriptFailureLines(script: SchemaScript, error: unknown): string[] {
  const driver = driverErrorOf(error);
  const code = typeof driver?.code === 'string' ? driver.code : undefined;
  const message =
    typeof driver?.message === 'string'
      ? driver.message
      : error instanceof Error
        ? error.message
        : String(error);
  return [
    `${PREFIX[script]}: SQLSTATE ${code ?? 'none'}: ${message}`,
    `${PREFIX[script]}: ${hintFor(script, code)}`,
  ];
}
