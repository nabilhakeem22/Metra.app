import 'server-only';
import type { ActionResult } from './result';
import { unexpectedFailure } from './unexpected';

/**
 * The answer for a result that did not deliver the data the caller needs: its
 * own failure passed on WHOLE (the code, the fields, the params and the
 * reference that finds its log line), never re-coded as a bare `generic`. A
 * result that says nothing usable (a success without its data, a failure
 * without a code) is a broken contract, logged under `label` with a reference.
 */
export function failureOf(result: ActionResult, label: string): ActionResult {
  if (result.ok || !result.error) return unexpectedFailure(`${label}: no data and no code`);
  const { error, fields, params, reference } = result;
  return {
    ok: false,
    error,
    ...(fields && { fields }),
    ...(params && { params }),
    ...(reference && { reference }),
  };
}
