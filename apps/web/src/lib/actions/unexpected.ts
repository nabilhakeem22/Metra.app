import 'server-only';
import { newFailureReference } from './failure-reference';
import { loggableFailure } from './loggable-failure';

/**
 * The answer to a failure nothing more specific can describe. With the mutation
 * tail (`mutation-failure.ts`), the ONLY producer of `generic`: it writes one log
 * line under `label` with a fresh reference, and hands the same reference to the
 * person, so a support message finds its line in `wrangler tail`.
 *
 * `label` says WHERE (developer text, never user data); `error` is the caught
 * value, logged through the `loggableFailure` whitelist only.
 */
export function unexpectedFailure(
  label: string,
  error?: unknown,
): { ok: false; error: 'generic'; reference: string } {
  const reference = newFailureReference();
  console.error(label, { reference, failure: loggableFailure(error) });
  return { ok: false, error: 'generic', reference };
}
