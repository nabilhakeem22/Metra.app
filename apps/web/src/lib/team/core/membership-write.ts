// A PURE team core: no next/*, no server-only (see ./index.ts).
import { isMembershipWriterViolation } from '@/lib/actions/db-conflict';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { fail } from '@/lib/actions/mutate';

/**
 * Runs one write on `memberships` whose caller the app has already gated.
 *
 * The database judges the same rule again, on the caller's role as it is NOW
 * (trg_memberships_role_writer, SQLSTATE MT150). The app's gate reads the role
 * the request was opened with, so the two disagree in one ordinary race: the
 * caller was demoted while this request was in flight. That is `forbidden`, the
 * answer the app's own gate gives, and the transaction rolls back whole.
 *
 * One redacted warning, no reference: an expected race, not a defect line, but a
 * refusal the app did not see coming is worth finding in `wrangler tail`. Any
 * other failure passes through untouched.
 */
export async function writeMembership(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (e) {
    if (!isMembershipWriterViolation(e)) throw e;
    console.warn('membership write refused by the database', { failure: loggableFailure(e) });
    fail('forbidden');
  }
}
