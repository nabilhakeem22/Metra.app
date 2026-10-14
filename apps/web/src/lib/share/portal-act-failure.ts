import 'server-only';
import { isAmbiguousDbOutcome } from '@/lib/actions/db-failure';
import { newFailureReference } from '@/lib/actions/failure-reference';
import { loggableFailure } from '@/lib/actions/loggable-failure';

/** A client act that failed underneath: an outcome nobody can confirm, or an
 *  unknown failure with the reference of its one log line. */
export type PortalFailure = { error: 'uncertain' } | { error: 'generic'; reference: string };

/**
 * What a client act answers when its run threw, with ONE log line through
 * loggableFailure (the driver's error fields, the SQLSTATE; never the failed
 * query's parameters, so no token hash, IP, user agent, note or comment body).
 *
 * A write that may still have committed (a lock wait that gave up, 55P03; a
 * connection that dropped) is `uncertain`: the client is told to refresh and
 * check, never to repeat blindly. Anything else is `generic` with a fresh
 * reference, logged beside it so the studio can find the line the client quotes.
 */
export function portalActFailure(act: string, error: unknown): PortalFailure {
  if (isAmbiguousDbOutcome(error)) {
    console.error('portal act failed', { act, failure: loggableFailure(error) });
    return { error: 'uncertain' };
  }
  const reference = newFailureReference();
  console.error('portal act failed', { act, reference, failure: loggableFailure(error) });
  return { error: 'generic', reference };
}
